// 進入點：瀏覽器沒有 Electron 時先掛上網頁版檔案存取，再依螢幕寬度載入手機版或電腦版介面
import './platform.js';

const mobile = window.lab.isWeb && matchMedia('(max-width: 820px)').matches;
document.documentElement.classList.toggle('web', !!window.lab.isWeb);
if (mobile) import('./mobile.js');
else import('./app.js');
