use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub struct PositionalWriter {
    file: Arc<File>,
    path: PathBuf,
}

impl PositionalWriter {
    pub fn new<P: AsRef<Path>>(path: P, preallocate_bytes: Option<u64>) -> Result<Self, std::io::Error> {
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

        if let Some(total_size) = preallocate_bytes {
            // Preallocate file length upfront (sparse / direct allocation on Windows)
            let _ = file.set_len(total_size);
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
            self.file.seek_write(data, offset)?;
        }

        #[cfg(not(target_os = "windows"))]
        {
            use std::os::unix::fs::FileExt;
            self.file.write_all_at(data, offset)?;
        }

        Ok(())
    }

    pub fn sync(&self) -> Result<(), std::io::Error> {
        self.file.sync_all()
    }

    pub fn file_path(&self) -> &Path {
        &self.path
    }
}
