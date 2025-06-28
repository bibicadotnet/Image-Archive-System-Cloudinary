CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder TEXT,
    filename TEXT,
    cloudinary_url TEXT NOT NULL,
    file_size INTEGER,
    cloud_name TEXT
);

CREATE TABLE IF NOT EXISTS rate_limits (
    ip TEXT PRIMARY KEY,
    count INTEGER,
    reset_time INTEGER
);

CREATE TABLE IF NOT EXISTS abuse_blocks (
    ip TEXT PRIMARY KEY,
    failed_count INTEGER,
    block_until INTEGER,
    last_attempt INTEGER
);

CREATE INDEX idx_images_folder_filename ON images(folder, filename);
