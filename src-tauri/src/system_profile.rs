use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

pub const LOW_RAM_HARDWARE_THRESHOLD_MB: u64 = 4608; // 4.5 GB catches all 4 GB RAM SKUs after iGPU/BIOS reservations
pub const LOW_AVAIL_RAM_TRIGGER_MB: u64 = 750;
pub const CRITICAL_AVAIL_RAM_TRIGGER_MB: u64 = 400;
pub const HIGH_MEMORY_LOAD_TRIGGER_PCT: u32 = 85;
pub const CRITICAL_MEMORY_LOAD_TRIGGER_PCT: u32 = 92;
pub const HEAVY_CPU_LOAD_TRIGGER_PCT: u32 = 85;

// Hysteresis deadbands prevent oscillation near threshold boundaries
const RELAX_FROM_HEAVY_CPU_PCT: u32 = 75;
const RELAX_FROM_HEAVY_MEM_PCT: u32 = 86;
const RELAX_FROM_HEAVY_AVAIL_MB: u64 = 550;

const RELAX_TO_NORMAL_CPU_PCT: u32 = 70;
const RELAX_TO_NORMAL_MEM_PCT: u32 = 78;
const RELAX_TO_NORMAL_AVAIL_MB: u64 = 1000;

pub const ESCALATION_CONFIRM_SAMPLES: u8 = 2;
pub const RELAX_CONFIRM_SAMPLES: u8 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SystemProfileMode {
    Normal,
    LowRam,
    HeavyLoad,
}

impl SystemProfileMode {
    fn severity(self) -> u8 {
        match self {
            SystemProfileMode::Normal => 0,
            SystemProfileMode::LowRam => 1,
            SystemProfileMode::HeavyLoad => 2,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemSample {
    pub total_phys_mb: u64,
    pub avail_phys_mb: u64,
    pub memory_load_pct: u32,
    pub cpu_load_pct: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemProfileSnapshot {
    pub mode: SystemProfileMode,
    pub eco_ui: bool,
    pub max_connections_cap: u32,
    pub max_concurrent_tasks: u32,
    pub telemetry_interval_ms: u64,
    pub ui_poll_interval_ms: u64,
    pub prewarm_dialogs: bool,
    pub destroy_dialogs_on_close: bool,
    pub force_background_priority: bool,
    pub total_phys_mb: u64,
    pub avail_phys_mb: u64,
    pub memory_load_pct: u32,
    pub cpu_load_pct: u32,
    pub is_low_ram_hardware: bool,
}

impl SystemProfileSnapshot {
    pub fn from_mode_and_sample(
        mode: SystemProfileMode,
        sample: &SystemSample,
        is_low_ram_hardware: bool,
    ) -> Self {
        match mode {
            SystemProfileMode::Normal => Self {
                mode,
                eco_ui: false,
                max_connections_cap: 32,
                max_concurrent_tasks: 3,
                telemetry_interval_ms: 150,
                ui_poll_interval_ms: 1000,
                prewarm_dialogs: true,
                destroy_dialogs_on_close: false,
                force_background_priority: false,
                total_phys_mb: sample.total_phys_mb,
                avail_phys_mb: sample.avail_phys_mb,
                memory_load_pct: sample.memory_load_pct,
                cpu_load_pct: sample.cpu_load_pct,
                is_low_ram_hardware,
            },
            SystemProfileMode::LowRam => Self {
                mode,
                eco_ui: true,
                max_connections_cap: 8,
                max_concurrent_tasks: 1,
                telemetry_interval_ms: 350,
                ui_poll_interval_ms: 3000,
                prewarm_dialogs: false,
                destroy_dialogs_on_close: true,
                force_background_priority: true,
                total_phys_mb: sample.total_phys_mb,
                avail_phys_mb: sample.avail_phys_mb,
                memory_load_pct: sample.memory_load_pct,
                cpu_load_pct: sample.cpu_load_pct,
                is_low_ram_hardware,
            },
            SystemProfileMode::HeavyLoad => Self {
                mode,
                eco_ui: true,
                max_connections_cap: 4,
                max_concurrent_tasks: 1,
                telemetry_interval_ms: 450,
                ui_poll_interval_ms: 3500,
                prewarm_dialogs: false,
                destroy_dialogs_on_close: true,
                force_background_priority: true,
                total_phys_mb: sample.total_phys_mb,
                avail_phys_mb: sample.avail_phys_mb,
                memory_load_pct: sample.memory_load_pct,
                cpu_load_pct: sample.cpu_load_pct,
                is_low_ram_hardware,
            },
        }
    }
}

pub struct ProfileStateTracker {
    mode: SystemProfileMode,
    is_low_ram_hardware: bool,
    last_sample: SystemSample,
    escalate_streak: u8,
    relax_streak: u8,
}

impl ProfileStateTracker {
    pub fn new(initial_sample: SystemSample) -> Self {
        let is_low_ram_hardware = initial_sample.total_phys_mb > 0
            && initial_sample.total_phys_mb <= LOW_RAM_HARDWARE_THRESHOLD_MB;
        let initial_mode = Self::classify_initial(&initial_sample, is_low_ram_hardware);
        Self {
            mode: initial_mode,
            is_low_ram_hardware,
            last_sample: initial_sample,
            escalate_streak: 0,
            relax_streak: 0,
        }
    }

    fn classify_initial(sample: &SystemSample, is_low_ram_hardware: bool) -> SystemProfileMode {
        if sample.avail_phys_mb <= CRITICAL_AVAIL_RAM_TRIGGER_MB
            || sample.memory_load_pct >= CRITICAL_MEMORY_LOAD_TRIGGER_PCT
            || sample.cpu_load_pct >= HEAVY_CPU_LOAD_TRIGGER_PCT
        {
            SystemProfileMode::HeavyLoad
        } else if is_low_ram_hardware
            || sample.avail_phys_mb <= LOW_AVAIL_RAM_TRIGGER_MB
            || sample.memory_load_pct >= HIGH_MEMORY_LOAD_TRIGGER_PCT
        {
            SystemProfileMode::LowRam
        } else {
            SystemProfileMode::Normal
        }
    }

    fn compute_target_mode(&self, sample: &SystemSample) -> SystemProfileMode {
        let is_heavy = sample.cpu_load_pct >= HEAVY_CPU_LOAD_TRIGGER_PCT
            || sample.memory_load_pct >= CRITICAL_MEMORY_LOAD_TRIGGER_PCT
            || sample.avail_phys_mb <= CRITICAL_AVAIL_RAM_TRIGGER_MB;
        if is_heavy {
            return SystemProfileMode::HeavyLoad;
        }

        let is_low_ram_pressure = self.is_low_ram_hardware
            || sample.memory_load_pct >= HIGH_MEMORY_LOAD_TRIGGER_PCT
            || sample.avail_phys_mb <= LOW_AVAIL_RAM_TRIGGER_MB;

        match self.mode {
            SystemProfileMode::Normal => {
                if is_low_ram_pressure {
                    SystemProfileMode::LowRam
                } else {
                    SystemProfileMode::Normal
                }
            }
            SystemProfileMode::LowRam => {
                if is_low_ram_pressure {
                    SystemProfileMode::LowRam
                } else if !self.is_low_ram_hardware
                    && sample.cpu_load_pct < RELAX_TO_NORMAL_CPU_PCT
                    && sample.memory_load_pct < RELAX_TO_NORMAL_MEM_PCT
                    && sample.avail_phys_mb > RELAX_TO_NORMAL_AVAIL_MB
                {
                    SystemProfileMode::Normal
                } else {
                    // Stay constrained inside the hysteresis deadband
                    SystemProfileMode::LowRam
                }
            }
            SystemProfileMode::HeavyLoad => {
                let clear_of_heavy = sample.cpu_load_pct < RELAX_FROM_HEAVY_CPU_PCT
                    && sample.memory_load_pct < RELAX_FROM_HEAVY_MEM_PCT
                    && sample.avail_phys_mb > RELAX_FROM_HEAVY_AVAIL_MB;
                if !clear_of_heavy {
                    SystemProfileMode::HeavyLoad
                } else if !self.is_low_ram_hardware
                    && !is_low_ram_pressure
                    && sample.cpu_load_pct < RELAX_TO_NORMAL_CPU_PCT
                    && sample.memory_load_pct < RELAX_TO_NORMAL_MEM_PCT
                    && sample.avail_phys_mb > RELAX_TO_NORMAL_AVAIL_MB
                {
                    SystemProfileMode::Normal
                } else {
                    SystemProfileMode::LowRam
                }
            }
        }
    }

    /// Evaluates a new hardware sample with hysteresis. Returns `Some(snapshot)` only on mode change.
    pub fn evaluate(&mut self, sample: SystemSample) -> Option<SystemProfileSnapshot> {
        self.last_sample = sample;
        let target = self.compute_target_mode(&sample);
        let current_sev = self.mode.severity();
        let target_sev = target.severity();

        if target_sev > current_sev {
            self.relax_streak = 0;
            self.escalate_streak = self.escalate_streak.saturating_add(1);
            if self.escalate_streak >= ESCALATION_CONFIRM_SAMPLES {
                self.mode = target;
                self.escalate_streak = 0;
                return Some(self.snapshot());
            }
        } else if target_sev < current_sev {
            self.escalate_streak = 0;
            self.relax_streak = self.relax_streak.saturating_add(1);
            if self.relax_streak >= RELAX_CONFIRM_SAMPLES {
                self.mode = target;
                self.relax_streak = 0;
                return Some(self.snapshot());
            }
        } else {
            self.escalate_streak = 0;
            self.relax_streak = 0;
        }

        None
    }

    pub fn snapshot(&self) -> SystemProfileSnapshot {
        SystemProfileSnapshot::from_mode_and_sample(
            self.mode,
            &self.last_sample,
            self.is_low_ram_hardware,
        )
    }
}

#[cfg(target_os = "windows")]
mod win_metrics {
    use super::{Mutex, OnceLock, SystemSample};

    #[repr(C)]
    struct MEMORYSTATUSEX {
        dw_length: u32,
        dw_memory_load: u32,
        ull_total_phys: u64,
        ull_avail_phys: u64,
        ull_total_page_file: u64,
        ull_avail_page_file: u64,
        ull_total_virtual: u64,
        ull_avail_virtual: u64,
        ull_avail_extended_virtual: u64,
    }

    #[repr(C)]
    #[derive(Copy, Clone, Default)]
    struct FILETIME {
        dw_low_date_time: u32,
        dw_high_date_time: u32,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalMemoryStatusEx(lp_buffer: *mut MEMORYSTATUSEX) -> i32;
        fn GetSystemTimes(
            lp_idle_time: *mut FILETIME,
            lp_kernel_time: *mut FILETIME,
            lp_user_time: *mut FILETIME,
        ) -> i32;
    }

    static PREV_CPU_TIMES: OnceLock<Mutex<Option<(u64, u64, u64)>>> = OnceLock::new();

    #[inline]
    fn filetime_to_u64(ft: FILETIME) -> u64 {
        ((ft.dw_high_date_time as u64) << 32) | (ft.dw_low_date_time as u64)
    }

    fn sample_cpu_load_pct() -> u32 {
        let mut idle = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();

        let ok = unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) };
        if ok == 0 {
            return 0;
        }

        let curr = (
            filetime_to_u64(idle),
            filetime_to_u64(kernel),
            filetime_to_u64(user),
        );

        let mutex = PREV_CPU_TIMES.get_or_init(|| Mutex::new(None));
        let mut prev_guard = mutex.lock();
        let cpu_pct = if let Some(prev) = *prev_guard {
            let idle_delta = curr.0.saturating_sub(prev.0);
            let kernel_delta = curr.1.saturating_sub(prev.1);
            let user_delta = curr.2.saturating_sub(prev.2);
            // Windows GetSystemTimes includes idle time inside kernel time
            let total_delta = kernel_delta.saturating_add(user_delta);
            let busy_delta = total_delta.saturating_sub(idle_delta);
            if total_delta > 0 {
                ((busy_delta.saturating_mul(100)) / total_delta).min(100) as u32
            } else {
                0
            }
        } else {
            0
        };
        *prev_guard = Some(curr);
        cpu_pct
    }

    pub fn sample_system_metrics() -> SystemSample {
        let mut mem = MEMORYSTATUSEX {
            dw_length: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            dw_memory_load: 0,
            ull_total_phys: 0,
            ull_avail_phys: 0,
            ull_total_page_file: 0,
            ull_avail_page_file: 0,
            ull_total_virtual: 0,
            ull_avail_virtual: 0,
            ull_avail_extended_virtual: 0,
        };

        let ok = unsafe { GlobalMemoryStatusEx(&mut mem) };
        let (total_phys_mb, avail_phys_mb, memory_load_pct) = if ok != 0 {
            (
                mem.ull_total_phys / (1024 * 1024),
                mem.ull_avail_phys / (1024 * 1024),
                mem.dw_memory_load.min(100),
            )
        } else {
            (8192, 4096, 50)
        };

        let cpu_load_pct = sample_cpu_load_pct();

        SystemSample {
            total_phys_mb,
            avail_phys_mb,
            memory_load_pct,
            cpu_load_pct,
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod win_metrics {
    use super::SystemSample;

    pub fn sample_system_metrics() -> SystemSample {
        SystemSample {
            total_phys_mb: 8192,
            avail_phys_mb: 4096,
            memory_load_pct: 50,
            cpu_load_pct: 0,
        }
    }
}

static PROFILE_STATE: OnceLock<RwLock<ProfileStateTracker>> = OnceLock::new();

fn tracker() -> &'static RwLock<ProfileStateTracker> {
    PROFILE_STATE.get_or_init(|| {
        let initial = win_metrics::sample_system_metrics();
        RwLock::new(ProfileStateTracker::new(initial))
    })
}

/// Initializes the automatic system profile tracker at startup using live OS telemetry.
pub fn init_system_profile() -> SystemProfileSnapshot {
    let snap = tracker().read().snapshot();
    eprintln!(
        "[SystemProfile] Booted in {:?} mode (total_ram={}MB, avail_ram={}MB, mem_load={}%, low_ram_hw={}, max_conns={}, max_concurrent={}, eco_ui={})",
        snap.mode,
        snap.total_phys_mb,
        snap.avail_phys_mb,
        snap.memory_load_pct,
        snap.is_low_ram_hardware,
        snap.max_connections_cap,
        snap.max_concurrent_tasks,
        snap.eco_ui
    );
    snap
}

/// Samples OS RAM/CPU load and evaluates whether the active profile mode transitioned.
/// Returns `Some(snapshot)` only when the active `SystemProfileMode` changed.
pub fn sample_and_evaluate() -> Option<SystemProfileSnapshot> {
    let sample = win_metrics::sample_system_metrics();
    let transition = tracker().write().evaluate(sample);
    if let Some(ref snap) = transition {
        eprintln!(
            "[SystemProfile] Transitioned to {:?} (avail_ram={}MB/{}MB, mem_load={}%, cpu_load={}%, max_conns={}, max_concurrent={}, eco_ui={})",
            snap.mode,
            snap.avail_phys_mb,
            snap.total_phys_mb,
            snap.memory_load_pct,
            snap.cpu_load_pct,
            snap.max_connections_cap,
            snap.max_concurrent_tasks,
            snap.eco_ui
        );
    }
    transition
}

pub fn current_snapshot() -> SystemProfileSnapshot {
    tracker().read().snapshot()
}

pub fn should_prewarm_dialogs() -> bool {
    current_snapshot().prewarm_dialogs
}

pub fn should_destroy_dialogs_on_close() -> bool {
    current_snapshot().destroy_dialogs_on_close
}

pub fn should_force_background_priority() -> bool {
    current_snapshot().force_background_priority
}

pub fn effective_max_connections(user_max: u32) -> u32 {
    let cap = current_snapshot().max_connections_cap.max(1);
    user_max.clamp(1, cap)
}

/// Permit weight for queue `Semaphore::new(3)`:
/// Normal = 1 permit per task (3 concurrent tasks),
/// LowRam / HeavyLoad = 3 permits per task (1 concurrent task).
pub fn concurrent_permit_weight() -> u32 {
    if current_snapshot().max_concurrent_tasks <= 1 {
        3
    } else {
        1
    }
}

pub fn current_telemetry_interval_ms() -> u64 {
    current_snapshot().telemetry_interval_ms
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(total_mb: u64, avail_mb: u64, mem_pct: u32, cpu_pct: u32) -> SystemSample {
        SystemSample {
            total_phys_mb: total_mb,
            avail_phys_mb: avail_mb,
            memory_load_pct: mem_pct,
            cpu_load_pct: cpu_pct,
        }
    }

    #[test]
    fn four_gb_hardware_boots_directly_in_low_ram_and_never_relaxes_to_normal() {
        let mut tracker = ProfileStateTracker::new(sample(4096, 1800, 56, 0));
        let boot = tracker.snapshot();
        assert_eq!(boot.mode, SystemProfileMode::LowRam);
        assert!(boot.is_low_ram_hardware);
        assert!(boot.eco_ui);
        assert!(!boot.prewarm_dialogs);
        assert!(boot.destroy_dialogs_on_close);
        assert_eq!(boot.max_connections_cap, 8);
        assert_eq!(boot.max_concurrent_tasks, 1);

        // Even with lots of healthy samples, 4 GB hardware must never leave LowRam for Normal
        for _ in 0..5 {
            assert!(tracker.evaluate(sample(4096, 2600, 35, 5)).is_none());
        }
        assert_eq!(tracker.snapshot().mode, SystemProfileMode::LowRam);
    }

    #[test]
    fn normal_pc_boots_in_normal_mode_and_ignores_single_transient_spike() {
        let mut tracker = ProfileStateTracker::new(sample(16384, 9500, 42, 0));
        let boot = tracker.snapshot();
        assert_eq!(boot.mode, SystemProfileMode::Normal);
        assert!(!boot.is_low_ram_hardware);
        assert!(!boot.eco_ui);
        assert!(boot.prewarm_dialogs);
        assert!(!boot.destroy_dialogs_on_close);
        assert_eq!(boot.max_connections_cap, 32);
        assert_eq!(boot.max_concurrent_tasks, 3);

        // Single CPU spike (tick 1) does NOT immediately flip mode
        assert!(tracker.evaluate(sample(16384, 9000, 45, 92)).is_none());
        assert_eq!(tracker.snapshot().mode, SystemProfileMode::Normal);

        // Returns healthy on tick 2 -> streak resets cleanly
        assert!(tracker.evaluate(sample(16384, 9200, 44, 18)).is_none());
        assert_eq!(tracker.snapshot().mode, SystemProfileMode::Normal);
    }

    #[test]
    fn high_ram_pc_escalates_on_sustained_load_and_recovers_after_three_healthy_ticks() {
        let mut tracker = ProfileStateTracker::new(sample(16384, 8200, 50, 0));
        assert_eq!(tracker.snapshot().mode, SystemProfileMode::Normal);

        // Sustained RAM pressure (2 consecutive ticks -> LowRam)
        assert!(tracker.evaluate(sample(16384, 650, 88, 30)).is_none());
        let esc = tracker
            .evaluate(sample(16384, 620, 89, 28))
            .expect("second strained sample should escalate to LowRam");
        assert_eq!(esc.mode, SystemProfileMode::LowRam);
        assert_eq!(esc.max_connections_cap, 8);

        // Escalate further on sustained heavy CPU load -> HeavyLoad
        assert!(tracker.evaluate(sample(16384, 3000, 72, 91)).is_none());
        let heavy = tracker
            .evaluate(sample(16384, 3000, 72, 94))
            .expect("second heavy CPU sample should escalate to HeavyLoad");
        assert_eq!(heavy.mode, SystemProfileMode::HeavyLoad);
        assert_eq!(heavy.max_connections_cap, 4);
        assert_eq!(heavy.ui_poll_interval_ms, 3500);

        // Hysteresis deadband (CPU 78% neither escalates nor relaxes)
        assert!(tracker.evaluate(sample(16384, 4500, 65, 78)).is_none());
        assert_eq!(tracker.snapshot().mode, SystemProfileMode::HeavyLoad);

        // 3 consecutive healthy samples cleanly relax back to Normal
        assert!(tracker.evaluate(sample(16384, 7000, 48, 12)).is_none());
        assert!(tracker.evaluate(sample(16384, 7200, 47, 10)).is_none());
        let recovered = tracker
            .evaluate(sample(16384, 7400, 46, 9))
            .expect("third healthy sample should return to Normal");
        assert_eq!(recovered.mode, SystemProfileMode::Normal);
        assert_eq!(recovered.max_connections_cap, 32);
        assert_eq!(recovered.max_concurrent_tasks, 3);
        assert!(!recovered.eco_ui);
    }

    #[test]
    fn four_gb_pc_escalates_to_heavy_load_then_relaxes_only_to_low_ram() {
        let mut tracker = ProfileStateTracker::new(sample(4096, 1500, 63, 0));
        assert_eq!(tracker.snapshot().mode, SystemProfileMode::LowRam);

        // Escalate to HeavyLoad after 2 critical ticks
        assert!(tracker.evaluate(sample(4096, 320, 93, 40)).is_none());
        let heavy = tracker
            .evaluate(sample(4096, 310, 94, 45))
            .expect("should enter HeavyLoad");
        assert_eq!(heavy.mode, SystemProfileMode::HeavyLoad);

        // Recover after 3 healthy ticks -> stops at LowRam (never Normal)
        assert!(tracker.evaluate(sample(4096, 1900, 53, 10)).is_none());
        assert!(tracker.evaluate(sample(4096, 1950, 52, 8)).is_none());
        let relaxed = tracker
            .evaluate(sample(4096, 2000, 51, 8))
            .expect("should step down to LowRam");
        assert_eq!(relaxed.mode, SystemProfileMode::LowRam);
    }
}
