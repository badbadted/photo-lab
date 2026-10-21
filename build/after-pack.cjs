'use strict';

/**
 * afterPack：把圖示與版本資訊寫進 exe。
 * 不用 electron-builder 內建的 rcedit：它包在 winCodeSign 裡，解壓需要建符號連結，
 * 本機沒開開發者模式會失敗，所以設 signAndEditExecutable: false，改用 npm 的 rcedit 自己補。
 * （做法沿用 race-music 的 build/after-pack.js）
 */
const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(__dirname, 'icon.ico');
  if (!fs.existsSync(exePath) || !fs.existsSync(iconPath)) {
    console.warn(`  ⚠ afterPack：找不到 ${fs.existsSync(exePath) ? 'build/icon.ico' : exePath}，略過圖示嵌入`);
    return;
  }
  const { rcedit } = require('rcedit'); // v5 匯出 { rcedit }
  const { version } = require('../package.json');
  await rcedit(exePath, {
    icon: iconPath,
    'version-string': {
      ProductName: 'Photo Lab',
      FileDescription: '自用修圖工具',
      CompanyName: 'badbadted',
      LegalCopyright: `© ${new Date().getFullYear()} badbadted`,
      OriginalFilename: exeName,
    },
    'file-version': version,
    'product-version': version,
  });
  console.log(`  • 已嵌入圖示與版本資訊  exe=${exeName}`);
};
