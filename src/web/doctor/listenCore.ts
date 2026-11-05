// 語音輸入的計時與收尾（不碰瀏覽器 API，測試直接用假的辨識器：tests/speech.test.ts）。
// speech.ts 拿瀏覽器的 SpeechRecognition 交給這裡。

export interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

export type RecognitionCtor = new () => RecognitionLike;

/** 說完停多久算說完（毫秒）；iPhone 不會自己停，靠這個 */
export const SILENCE_MS = 1500;
/** 一直沒聽到聲音就停 */
export const NO_SPEECH_MS = 10_000;
/** 最長聽多久 */
export const MAX_LISTEN_MS = 60_000;
/** 按停止之後等瀏覽器收尾多久：iPhone 常常不會回 onend，時間到就自己結束 */
export const END_GRACE_MS = 800;

/**
 * 開始聽：說話時不斷回傳目前聽到的字；結束時呼叫一次 onEnd（停頓、按停止、取消、出錯都只呼叫一次）。
 * 回傳停止函式：stop() 收尾（聽到的字照樣交出去）、stop(true) 取消。
 *
 * iPhone（Safari、加到主畫面的 App）的語音辨識：按 stop() 常常不回 onend、說完停頓也不會自己結束，
 * 所以不等瀏覽器：停頓、逾時、收尾都自己計時，時間到就結束（2026-11-05 Nathan 的 iPhone 卡在「我在聽…」）。
 */
export function listenWith(
  Ctor: RecognitionCtor,
  onText: (text: string, final: boolean) => void,
  onEnd: (error?: string, cancelled?: boolean) => void,
): (cancel?: boolean) => void {
  const r = new Ctor();
  r.lang = 'zh-TW';
  r.interimResults = true;
  r.continuous = false;
  let errored: string | undefined;
  let heard = false;
  let done = false;
  let silence: ReturnType<typeof setTimeout> | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
  const timers: ReturnType<typeof setTimeout>[] = [];

  const finish = (cancelled = false) => {
    if (done) return;
    done = true;
    clearTimeout(silence);
    clearTimeout(grace);
    timers.forEach(clearTimeout);
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
    try {
      if (r.abort) r.abort();
      else r.stop();
    } catch {
      // 已經停了
    }
    onEnd(cancelled ? undefined : errored, cancelled);
  };
  /** 請瀏覽器收尾（會再送最後一段字）；等不到 onend 就自己結束 */
  const wrapUp = () => {
    if (done || grace) return;
    try {
      r.stop();
    } catch {
      // 已經停了
    }
    grace = setTimeout(() => finish(), END_GRACE_MS);
  };

  r.onresult = (e) => {
    let text = '';
    let final = false;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      final = e.results[i].isFinal;
    }
    if (text.trim()) heard = true;
    onText(text, final);
    clearTimeout(silence);
    silence = setTimeout(wrapUp, SILENCE_MS);
  };
  r.onerror = (e) => {
    errored = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? '沒有麥克風或語音辨識權限，請到手機設定打開' : e.error === 'no-speech' || e.error === 'aborted' ? undefined : `語音辨識：${e.error}`;
    if (errored) finish();
  };
  r.onend = () => finish();
  timers.push(
    setTimeout(() => {
      if (!heard) wrapUp();
    }, NO_SPEECH_MS),
    setTimeout(wrapUp, MAX_LISTEN_MS),
  );
  try {
    r.start();
  } catch (e) {
    errored = `語音辨識：${e instanceof Error ? e.message : String(e)}`;
    finish();
  }
  return (cancel = false) => (cancel ? finish(true) : wrapUp());
}
