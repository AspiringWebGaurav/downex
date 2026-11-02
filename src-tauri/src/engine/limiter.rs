use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Robust multi-worker Token Bucket Rate Limiter
/// Accurately bounds aggregate multi-stream download throughput to the target speed limit.
#[derive(Clone)]
pub struct TaskSpeedLimiter {
    pub max_bytes_per_sec: Arc<AtomicU64>,
    state: Arc<parking_lot::Mutex<LimiterState>>,
}

struct LimiterState {
    tokens: f64,
    last_tick: Instant,
}

impl TaskSpeedLimiter {
    pub fn new(initial_limit_bytes_sec: u64) -> Self {
        Self {
            max_bytes_per_sec: Arc::new(AtomicU64::new(initial_limit_bytes_sec)),
            state: Arc::new(parking_lot::Mutex::new(LimiterState {
                tokens: 0.0,
                last_tick: Instant::now(),
            })),
        }
    }

    pub fn set_limit(&self, bytes_per_sec: u64) {
        self.max_bytes_per_sec.store(bytes_per_sec, Ordering::SeqCst);
        let mut lock = self.state.lock();
        lock.last_tick = Instant::now();
        // Reset tokens on limit change so rate transition is immediate
        lock.tokens = 0.0;
    }

    pub fn get_limit(&self) -> u64 {
        self.max_bytes_per_sec.load(Ordering::SeqCst)
    }

    pub async fn throttle(&self, bytes: usize) {
        let rate = self.max_bytes_per_sec.load(Ordering::Relaxed) as f64;
        if rate <= 0.0 || bytes == 0 {
            return;
        }

        let sleep_dur = {
            let mut lock = self.state.lock();
            let now = Instant::now();
            let elapsed = (now - lock.last_tick).as_secs_f64();
            lock.last_tick = now;

            // Replenish tokens based on elapsed wall-clock time
            // Cap accumulated tokens to at most 100ms of throughput (or 64KB) to avoid burst overshoot
            let max_burst = (rate * 0.10).max(65536.0);
            lock.tokens = (lock.tokens + elapsed * rate).min(max_burst);

            // Deduct transferred chunk bytes
            lock.tokens -= bytes as f64;

            if lock.tokens < 0.0 {
                let debt = -lock.tokens;
                // Clamp max debt to 500ms to prevent runaway lockup during system suspend
                let max_backlog = (rate * 0.50).max(262144.0);
                if debt > max_backlog {
                    lock.tokens = -max_backlog;
                }
                let clamped_debt = debt.min(max_backlog);
                Some(Duration::from_secs_f64(clamped_debt / rate))
            } else {
                None
            }
        };

        if let Some(dur) = sleep_dur {
            // Sleep the exact duration required to accurately enforce the rate limit
            tokio::time::sleep(dur.min(Duration::from_millis(500))).await;
        }
    }
}
