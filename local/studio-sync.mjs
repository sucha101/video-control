import {GoogleSheetsClient} from './google.mjs';

export async function runStudioSync({config, studio, sheets = new GoogleSheetsClient({
  spreadsheetId: config.sheetId, tab: config.sheetTab, credentialsPath: config.googleCredentials})}) {
  const items = await studio.claimSyncOutbox(10);
  if (!items.length) return {completedCount: 0, failedCount: 0};
  const completedIds = [], failedIds = [];
  let rows;
  try { rows = await sheets.readRows('A2:P'); }
  catch (error) {
    await studio.completeSyncOutbox({failedIds: items.map(item => item.id)});
    throw error;
  }
  for (const item of items) {
    try {
      const payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;
      const matches = rows.map((row, index) => row?.[0] === payload.displayId ? index : -1).filter(i => i >= 0);
      if (matches.length > 1) throw new Error('ID trùng trên Sheet');
      const foundRow = matches.length ? matches[0] + 2 : null;
      if (item.kind === 'request_created') {
        if (!foundRow) {
          const row = [payload.displayId, payload.title, payload.script, payload.skill, 'Chờ duyệt', 'Chờ máy',
            payload.voice || '', '', payload.notes || '', '', '', '', 'Duyệt trên web', '', '', ''];
          await sheets.appendRow(row);
          // Appends may skip formatted blank rows: resolve actual position before subsequent updates.
          rows = await sheets.readRows('A2:P');
        }
      } else if (item.kind === 'production_completed') {
        if (!foundRow) throw new Error('Chưa tìm thấy hàng kết quả; giữ outbox để thử lại');
        await sheets.batchUpdateRanges([
          {range: `F${foundRow}:F${foundRow}`, values: [['Hoàn tất']]},
          {range: `J${foundRow}:L${foundRow}`, values: [[payload.driveUrl, payload.caption || '', payload.hashtags || '']]}
        ]);
      } else throw new Error(`Loại outbox chưa hỗ trợ: ${item.kind}`);
      completedIds.push(item.id);
    } catch { failedIds.push(item.id); }
  }
  await studio.completeSyncOutbox({completedIds, failedIds});
  return {completedCount: completedIds.length, failedCount: failedIds.length};
}
