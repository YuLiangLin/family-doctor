// 測試用：記憶體裡的 R2，只實作本專案用到的 put／get／delete。
export class ShimR2 {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();

  async put(key: string, value: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    this.objects.set(key, { bytes: bytes.slice(), contentType: opts?.httpMetadata?.contentType });
    return { key, size: bytes.byteLength };
  }

  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    return {
      key,
      size: o.bytes.byteLength,
      httpMetadata: { contentType: o.contentType },
      body: new Response(o.bytes).body,
      arrayBuffer: async () => o.bytes.slice().buffer,
    };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  asR2(): R2Bucket {
    return this as unknown as R2Bucket;
  }
}
