export const VERSION = 1;
export const LEASE_MS = 180000;
export const SKILLS = Object.freeze(['viet-tiktok-story-video', 'drama-mascot-video']);
export const JOB_TYPES = Object.freeze(['scan','produce','add_row','approve','set_skill','set_mode','publish']);
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function boundedString(value, name, max = 64) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw new HttpError(400, `${name}: nội dung không hợp lệ`);
  return value;
}
export function validId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) throw new HttpError(400,'ID không hợp lệ');
  return value;
}
export function validSkill(value) {
  if (!SKILLS.includes(value)) throw new HttpError(400,'Skill không được hỗ trợ');
  return value;
}
export function validSchedule(value) {
  const local = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(value);
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  const normalized = local ? `${local[1]}T${local[2]}:00+07:00` : value;
  const prefix = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value);
  if ((!local && !iso) || !prefix || !Number.isFinite(Date.parse(normalized))) throw new HttpError(400,'Ngày giờ không hợp lệ');
  const [,y,m,d,h,min] = prefix.map(Number);
  if (m<1 || m>12 || d<1 || d>new Date(Date.UTC(y,m,0)).getUTCDate() || h>23 || min>59) throw new HttpError(400,'Ngày giờ không hợp lệ');
  return value;
}
export function validateJob(type, payload) {
  if (!JOB_TYPES.includes(type) || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new HttpError(400,'Loại lệnh không hợp lệ');
  const keys = {scan:[], produce:['videoId','fingerprint'],approve:['videoId'],set_skill:['videoId','skill'],set_mode:['videoId','mode'],publish:['videoId','schedule'],add_row:['skill','title','script']}[type];
  if (Object.keys(payload).some(k => !keys.includes(k))) throw new HttpError(400,'Nội dung lệnh không hợp lệ');
  if (type !== 'scan' && type !== 'add_row') validId(payload.videoId);
  if (type === 'set_skill' || type === 'add_row') validSkill(payload.skill);
  if (type === 'set_mode' && !['video','auto'].includes(payload.mode)) throw new HttpError(400,'Chế độ không hợp lệ');
  if (type === 'add_row') { boundedString(payload.title,'Tiêu đề',200); boundedString(payload.script,'Kịch bản',12000); }
  if (payload.fingerprint !== undefined) boundedString(payload.fingerprint,'Fingerprint',256);
  if (payload.schedule !== undefined) validSchedule(payload.schedule);
  return {type,payload};
}
export function jobSummary(job) {
  const {leaseToken,workerId,leaseExpiresAt,payload,...summary} = job;
  return {...summary, payload: payload.videoId ? {videoId:payload.videoId} : {}};
}
export function safeText(value, secrets = []) {
  let text = String(value ?? '').replace(/https?:\/\/\S+/gi,'[đường dẫn]').replace(/[\u0000-\u001f]/g,' ');
  for (const secret of secrets.filter(s=>typeof s==='string' && s.length)) text = text.split(secret).join('[ẩn]');
  return text.slice(0,400);
}
