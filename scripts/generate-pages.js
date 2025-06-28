const fs = require('fs');
const path = require('path');

// 🔧 Cấu hình tập trung
const CONFIG = {
  PAGE_COUNT: 19,
  SERVER_PREFIX: 'iserver', // sẽ được dùng cho cả tên thư mục và tên project
};

// Đường dẫn thư mục chứa tất cả các server, VD: server/, app/, site/
const serverRoot = path.join(__dirname, '..', CONFIG.SERVER_PREFIX);
if (!fs.existsSync(serverRoot)) fs.mkdirSync(serverRoot);

const originalCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf-8');

for (let i = 1; i <= CONFIG.PAGE_COUNT; i++) {
  const serverName = `${CONFIG.SERVER_PREFIX}${i}`;
  const pageDir = path.join(serverRoot, serverName);

  // Xoá và tạo lại thư mục
  if (fs.existsSync(pageDir)) fs.rmSync(pageDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(pageDir, 'functions'), { recursive: true });

  // Ghi file index.js
  fs.writeFileSync(path.join(pageDir, 'functions', 'index.js'), originalCode);

  // Ghi file wrangler.toml (đã loại bỏ [env.production.vars])
  const wranglerConfig = `
name = "${serverName}"
compatibility_date = "2024-01-01"
pages_build_output_dir = "."

[env.production]
name = "${serverName}"

[[env.production.d1_databases]]
binding = "DB"
database_name = "image-archive-db"
database_id = "xxxxx"
`;

  fs.writeFileSync(path.join(pageDir, 'wrangler.toml'), wranglerConfig.trimStart());
}

console.log(`Đã tạo ${CONFIG.PAGE_COUNT} pages trong thư mục "${CONFIG.SERVER_PREFIX}/", từ ${CONFIG.SERVER_PREFIX}1 đến ${CONFIG.SERVER_PREFIX}${CONFIG.PAGE_COUNT}`);
