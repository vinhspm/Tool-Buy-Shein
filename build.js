const fs = require('fs-extra');
const JavaScriptObfuscator = require('javascript-obfuscator');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const DIST_DIR = path.join(__dirname, 'build_vps');
const ROOT_FILES_TO_COPY = ['package.json', 'package-lock.json', 'config.json'];

async function build() {
  console.log('🧹 Vệ sinh thư mục build cũ...');
  await fs.emptyDir(DIST_DIR);

  console.log('📂 Đang chép thư mục và file cấu hình...');
  // Chép thư mục public (nội dung tĩnh)
  await fs.copy(path.join(__dirname, 'public'), path.join(DIST_DIR, 'public'));
  
  // Chép thư mục src trước khi làm rối
  await fs.copy(SRC_DIR, path.join(DIST_DIR, 'src'));
  
  console.log('🔐 Bắt đầu mã hóa (Obfuscating) các file Source Code...');
  const files = await getFiles(path.join(DIST_DIR, 'src'));
  for (const file of files) {
    if (file.endsWith('.js')) {
      const code = await fs.readFile(file, 'utf8');
      const obfuscationResult = JavaScriptObfuscator.obfuscate(code, {
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.75,
        deadCodeInjection: true,
        deadCodeInjectionThreshold: 0.4,
        stringArray: true,
        stringArrayEncoding: ['base64'],
        stringArrayThreshold: 0.75,
        target: 'node'
      });
      await fs.writeFile(file, obfuscationResult.getObfuscatedCode());
    }
  }

  console.log('🔐 Phù phép mã hóa luôn file root server.js...');
  const serverCode = await fs.readFile(path.join(__dirname, 'server.js'), 'utf8');
  const obfuscatedServerCode = JavaScriptObfuscator.obfuscate(serverCode, {
    target: 'node',
    stringArray: true,
    stringArrayEncoding: ['base64']
  });
  await fs.writeFile(path.join(DIST_DIR, 'server.js'), obfuscatedServerCode.getObfuscatedCode());

  console.log('📝 Chép tiếp package.json...');
  for (const file of ROOT_FILES_TO_COPY) {
    if (await fs.pathExists(file)) {
      await fs.copy(path.join(__dirname, file), path.join(DIST_DIR, file));
    }
  }

  // Khởi tạo các thư mục trống sẵn để deploy không bị dội lỗi
  await fs.ensureDir(path.join(DIST_DIR, 'logs'));
  await fs.ensureDir(path.join(DIST_DIR, 'uploads'));

  console.log('✅ HOÀN TẤT BUILD! Giờ bạn chỉ cần mang thư mục "build_vps" vứt lên VPS và chạy PM2.');
}

// Hàm quét đệ quy các thư mục trong \src
async function getFiles(dir) {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(dirents.map((dirent) => {
    const res = path.resolve(dir, dirent.name);
    return dirent.isDirectory() ? getFiles(res) : res;
  }));
  return Array.prototype.concat(...files);
}

build().catch(err => console.error('Build rớt mạng:', err));
