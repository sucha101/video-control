/**
 * Tự động tạo captions.json chuẩn cấu trúc Remotion và Safe-zone TikTok
 * Dựa trên danh sách câu thoại (lines) và durations (thời lượng giây của từng scene)
 */

export function splitTextIntoChunks(text, maxWordsPerChunk = 7) {
  const clean = text.trim();
  if (!clean) return [];

  // Thử ngắt theo dấu câu tự nhiên trước: phẩy, chấm lửng, gạch ngang, hai chấm
  const naturalParts = clean.split(/(?<=[,;:\–\—\.\.\.])\s+/).filter(Boolean);
  if (naturalParts.length >= 2 && naturalParts.every(p => p.split(/\s+/).length <= maxWordsPerChunk + 2)) {
    return naturalParts;
  }

  // Nếu câu dài không có dấu ngắt tự nhiên, ngắt theo số lượng từ
  const words = clean.split(/\s+/);
  if (words.length <= maxWordsPerChunk) {
    return [clean];
  }

  const chunks = [];
  const mid = Math.ceil(words.length / 2);
  chunks.push(words.slice(0, mid).join(' '));
  chunks.push(words.slice(mid).join(' '));
  return chunks;
}

export function generateCaptions({lines, durations}) {
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const sceneNum = i + 1;
    const line = lines[i];
    const durationSec = durations[String(sceneNum)] || durations[sceneNum] || 3.0;
    const totalMs = Math.round(durationSec * 1000);

    const chunks = splitTextIntoChunks(line);
    if (chunks.length === 0) continue;

    const totalWords = chunks.reduce((acc, c) => acc + c.split(/\s+/).length, 0);
    const captions = [];
    let currentStartMs = 0;

    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c];
      const wordCount = chunk.split(/\s+/).length;
      const chunkRatio = totalWords > 0 ? wordCount / totalWords : 1 / chunks.length;
      let chunkDurationMs = Math.round(totalMs * chunkRatio);

      // Nếu là chunk cuối, cho endMs bằng đúng totalMs
      let endMs = (c === chunks.length - 1) ? totalMs : currentStartMs + chunkDurationMs;
      if (endMs > totalMs) endMs = totalMs;

      captions.push({
        text: chunk,
        startMs: currentStartMs,
        endMs: endMs,
        timestampMs: null,
        confidence: null
      });

      currentStartMs = endMs;
    }

    result.push({
      scene: sceneNum,
      captions
    });
  }

  return result;
}
