/** 這台裝置能不能跑 WebGL（不能的話 Dr.水獺 用 2D 頭像）；獨立一個檔，免得為了檢查就載入 three.js */
export function canUseWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
