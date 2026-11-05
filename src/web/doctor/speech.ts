// 用說的問、聽 Dr.Claude 回答：瀏覽器內建的語音辨識與朗讀（iPhone Safari、Android Chrome 都有）。
// 注意：語音轉文字是瀏覽器交給自家服務做的（Chrome → Google、iPhone → Apple），朗讀在裝置上做；我們的伺服器只收到轉好的文字。

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canListen = () => recognitionCtor() !== null;
export const canSpeak = () => 'speechSynthesis' in window;

/** 開始聽：說話時不斷回傳目前聽到的字；結束（停頓、按停止）時呼叫 onEnd */
export function listen(onText: (text: string, final: boolean) => void, onEnd: (error?: string) => void): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    onEnd('這個瀏覽器不支援語音輸入');
    return () => undefined;
  }
  const r = new Ctor();
  r.lang = 'zh-TW';
  r.interimResults = true;
  r.continuous = false;
  let errored: string | undefined;
  r.onresult = (e) => {
    let text = '';
    let final = false;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      final = e.results[i].isFinal;
    }
    onText(text, final);
  };
  r.onerror = (e) => {
    errored = e.error === 'not-allowed' ? '沒有麥克風權限，請到手機設定打開' : e.error === 'no-speech' ? undefined : `語音辨識：${e.error}`;
  };
  r.onend = () => onEnd(errored);
  r.start();
  return () => r.stop();
}

function zhVoice(): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang === 'zh-TW') ?? voices.find((v) => v.lang.startsWith('zh-Hant')) ?? voices.find((v) => v.lang.startsWith('zh'));
}

/** 朗讀前把條列符號、markdown 拿掉，念起來比較自然 */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#*_`>|]/g, '')
    .replace(/^\s*[-•]\s*/gm, '')
    .replace(/\n{2,}/g, '。')
    .replace(/\n/g, '，')
    .slice(0, 1200);
}

/** 朗讀；回傳停止函式 */
export function speak(text: string, on: { start?: () => void; end?: () => void }): () => void {
  if (!canSpeak()) {
    on.end?.();
    return () => undefined;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(speakable(text));
  u.lang = 'zh-TW';
  const v = zhVoice();
  if (v) u.voice = v;
  u.rate = 1.05;
  u.pitch = 1.1;
  u.onstart = () => on.start?.();
  u.onend = () => on.end?.();
  u.onerror = () => on.end?.();
  speechSynthesis.speak(u);
  return () => speechSynthesis.cancel();
}

/**
 * iPhone 的朗讀要在「使用者按了按鈕」那一刻先念過一次，之後 Dr.Claude 回覆時才能自動念出來。
 * 打開語音對話／朗讀的那一下先念一個聽不到的空白。
 */
export function unlockSpeech() {
  if (!canSpeak()) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch {
    // 不支援就算了：回覆時按喇叭也能念
  }
}

export function stopSpeaking() {
  if (canSpeak()) speechSynthesis.cancel();
}
