import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { END_GRACE_MS, listenWith, MAX_LISTEN_MS, NO_SPEECH_MS, SILENCE_MS, type RecognitionCtor } from '../src/web/doctor/listenCore';

type Handler<T> = ((e: T) => void) | null;

/** 假的語音辨識：行為像 iPhone（stop() 之後不一定回 onend、停頓也不會自己結束） */
class FakeRecognition {
  static last: FakeRecognition;
  lang = '';
  interimResults = false;
  continuous = false;
  onresult: Handler<{ results: unknown }> = null;
  onerror: Handler<{ error: string }> = null;
  onend: (() => void) | null = null;
  started = 0;
  stopped = 0;
  aborted = 0;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started++;
  }
  stop() {
    this.stopped++;
  }
  abort() {
    this.aborted++;
  }
  say(text: string, final = false) {
    this.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal: final })] });
  }
}

let ends: [string | undefined, boolean | undefined][];
let texts: string[];
const start = () => listenWith(FakeRecognition as unknown as RecognitionCtor, (t) => texts.push(t), (error, cancelled) => ends.push([error, cancelled]));

beforeEach(() => {
  vi.useFakeTimers();
  ends = [];
  texts = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('語音輸入（iPhone 不回 onend 也不會卡住）', () => {
  it('按停止但瀏覽器不回 onend：時間到自己結束，聽到的字照樣交出去，只結束一次', () => {
    const stop = start();
    const r = FakeRecognition.last;
    expect(r.started).toBe(1);
    r.say('頭有點痛');
    stop();
    expect(r.stopped).toBe(1);
    expect(ends).toEqual([]);
    vi.advanceTimersByTime(END_GRACE_MS);
    expect(ends).toEqual([[undefined, false]]);
    expect(texts).toEqual(['頭有點痛']);
    // 瀏覽器很晚才回 onend、再按一次停止：都不會再結束一次
    r.onend?.();
    stop();
    vi.advanceTimersByTime(MAX_LISTEN_MS);
    expect(ends).toHaveLength(1);
  });

  it('瀏覽器有回 onend 就馬上結束', () => {
    const stop = start();
    stop();
    FakeRecognition.last.onend?.();
    expect(ends).toEqual([[undefined, false]]);
  });

  it('說完停頓就算說完', () => {
    start();
    const r = FakeRecognition.last;
    r.say('發燒');
    vi.advanceTimersByTime(SILENCE_MS - 100);
    r.say('發燒三十八度');
    vi.advanceTimersByTime(SILENCE_MS - 100);
    expect(r.stopped).toBe(0);
    vi.advanceTimersByTime(100);
    expect(r.stopped).toBe(1);
    vi.advanceTimersByTime(END_GRACE_MS);
    expect(ends).toEqual([[undefined, false]]);
  });

  it('取消：馬上結束、標記取消', () => {
    const stop = start();
    FakeRecognition.last.say('不要送');
    stop(true);
    expect(ends).toEqual([[undefined, true]]);
    expect(FakeRecognition.last.aborted).toBe(1);
  });

  it('一直沒聽到聲音、聽太久都會自己停', () => {
    start();
    vi.advanceTimersByTime(NO_SPEECH_MS + END_GRACE_MS);
    expect(ends).toEqual([[undefined, false]]);

    ends = [];
    start();
    const r = FakeRecognition.last;
    for (let t = 0; t < MAX_LISTEN_MS; t += SILENCE_MS - 200) {
      r.say(`一直講${t}`);
      vi.advanceTimersByTime(SILENCE_MS - 200);
    }
    vi.advanceTimersByTime(END_GRACE_MS);
    expect(ends).toEqual([[undefined, false]]);
  });

  it('沒有權限：回看得懂的錯誤；沒聽到聲音不算錯', () => {
    start();
    FakeRecognition.last.onerror?.({ error: 'not-allowed' });
    expect(ends[0][0]).toContain('權限');

    ends = [];
    start();
    FakeRecognition.last.onerror?.({ error: 'no-speech' });
    FakeRecognition.last.onend?.();
    expect(ends).toEqual([[undefined, false]]);
  });
});
