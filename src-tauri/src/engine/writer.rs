use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub struct PositionalWriter {
    file: Arc<File>,
    path: PathBuf,
}

impl PositionalWriter {
    pub fn new<P: AsRef<Path>>(
        path: P,
        preallocate_bytes: Option<u64>,
        is_resume: bool,
    ) -> Result<Self, std::io::Error> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        #[cfg(target_os = "windows")]
        use std::os::windows::fs::OpenOptionsExt;

        let mut opts = OpenOptions::new();
        opts.read(true).write(true).create(true);
        #[cfg(target_os = "windows")]
        opts.share_mode(7); // FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
        let file = opts.open(&path)?;

        // Enable NTFS Sparse File allocation on Windows for instantaneous large file preallocation.
        // Prevents multi-second synchronous disk locking and system freezes on 10GB-100GB+ downloads.
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::io::AsRawHandle;
            const FSCTL_SET_SPARSE: u32 = 0x000900C4;
            extern "system" {
                fn DeviceIoControl(
                    hDevice: *mut std::ffi::c_void,
                    dwIoControlCode: u32,
                    lpInBuffer: *mut std::ffi::c_void,
                    nInBufferSize: u32,
                    lpOutBuffer: *mut std::ffi::c_void,
                    nOutBufferSize: u32,
                    lpBytesReturned: *mut u32,
                    lpOverlapped: *mut std::ffi::c_void,
                ) -> i32;
            }

            let handle = file.as_raw_handle();
            let mut bytes_returned: u32 = 0;
            unsafe {
                DeviceIoControl(
                    handle,
                    FSCTL_SET_SPARSE,
                    std::ptr::null_mut(),
                    0,
                    std::ptr::null_mut(),
                    0,
                    &mut bytes_returned,
                    std::ptr::null_mut(),
                );
            }
        }

        if !is_resume {
            // Fresh download: Clean truncate any existing stale file / clusters to 0 bytes
            let _ = file.set_len(0);
            if let Some(total_size) = preallocate_bytes {
                if total_size > 0 {
                    let _ = file.set_len(total_size);
                }
            }
        } else if let Some(total_size) = preallocate_bytes {
            // Resuming: ensure file length is at least total_size without wiping existing data
            if let Ok(meta) = file.metadata() {
                if meta.len() < total_size {
                    let _ = file.set_len(total_size);
                }
            }
        }

        Ok(Self {
            file: Arc::new(file),
            path,
        })
    }

    /// Performs an atomic positional write at exact byte offset without mutating the global seek pointer.
    pub fn write_at(&self, offset: u64, data: &[u8]) -> Result<(), std::io::Error> {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::fs::FileExt;
            let mut total_written = 0;
            while total_written < data.len() {
                let n = self.file.seek_write(&data[total_written..], offset + total_written as u64)?;
                if n == 0 {
                    return Err(std::io::Error::new(std::io::ErrorKind::WriteZero, "failed to write whole buffer"));
                }
                total_written += n;
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            use std::os::unix::fs::FileExt;
            self.file.write_all_at(data, offset)?;
        }

        Ok(())
    }

    pub fn set_len(&self, size: u64) -> Result<(), std::io::Error> {
        self.file.set_len(size)
    }

    pub fn sync(&self) -> Result<(), std::io::Error> {
        self.file.sync_all()
    }

    pub fn file_path(&self) -> &Path {
        &self.path
    }
}
