# Hướng dẫn Vận hành Video Studio & Zalo Video Bot

Hệ thống tự động hóa sản xuất video ngắn TikTok/Shorts/Reels cộng tác hai người (người dùng máy tính ở nhà & anh trai dùng điện thoại tại Hà Nội) qua giao diện Web di động và tin nhắn Zalo, kết hợp Cloudflare Durable Objects SQLite, Google Sheets, Google Drive và Buffer.

---

## 1. Kiến trúc hệ thống
- **Cloudflare Worker & SQLite Durable Object (`cloud/`)**:
  - Hàng đợi đám mây bền vững 24/7 trên SQLite Durable Object.
  - Web UI di động (`cloud/web/`) phục vụ static assets qua Cloudflare Worker Assets với bảo mật PBKDF2 salt, cookie httpOnly, rotating CSRF và chống XSS tuyệt đối.
  - Phân quyền: `owner` (người làm máy ở nhà) và `collaborator` (anh trai gửi kịch bản và duyệt video).
  - V001 được đánh dấu là dữ liệu lịch sử (`legacy_readonly`), tuyệt đối không bị đăng lại. Các bài mới tự động cấp mã từ `V002`.
- **Local Runner (`local/`)**:
  - Chạy trên máy tính Windows cá nhân có GPU/TTS/Remotion.
  - Điều phối Codex AI theo Skill (`viet-tiktok-story-video` hoặc `drama-mascot-video`).
  - Kiểm tra media stream trước khi xuất bản (`probeMediaUrl`), gọi Buffer GraphQL và cập nhật biên nhận độc lập từng kênh vào DO.
- **Google Sheets**: Nơi gương hai chiều lưu trữ kịch bản, trạng thái duyệt, Drive URL và caption. Đồng bộ batch không ghi đè công thức.
- **Buffer**: Adapter lên lịch và xuất bản video lên YouTube Shorts, TikTok, Facebook Reels.

---

## 2. Cài đặt & Chuẩn bị

### Bước 1: Kiểm tra hệ thống
Chạy kiểm tra tình trạng máy tính:
```bash
npm run doctor
```
Hoặc nhấp đúp chuột vào file `SETUP.cmd`.

### Bước 2: Thiết lập tài khoản Web Studio
Tạo mật khẩu băm bảo mật PBKDF2 cho 2 tài khoản:
```bash
node local/setup-web-users.mjs
```
Lệnh sẽ in chuỗi JSON `WEB_USERS_JSON`. Cài đặt lên Cloudflare Worker:
```bash
cd cloud
npx wrangler secret put WEB_USERS_JSON
```
(dán chuỗi JSON vừa tạo vào).

### Bước 3: Kết nối tài khoản Google
Để Runner có thể đọc/ghi Google Sheet và tải video lên Google Drive:
1. Đặt file OAuth Client JSON vào:
   `%USERPROFILE%\.codex\video-bot\client_secret.json`
2. Chạy lệnh:
   ```bash
   npm run connect:google
   ```
3. Mở đường link hiển thị trong terminal bằng trình duyệt và đăng nhập. File token sẽ được lưu tại `%USERPROFILE%\.codex\video-bot\google.json`.

### Bước 4: Cấu hình thông tin bí mật máy Runner
Lưu tại `%USERPROFILE%\.codex\video-bot\secrets.json`:
```json
{
  "bufferApiKey": "<TOKEN_BUFFER_GRAPHQL>",
  "runnerToken": "<BEARER_TOKEN_KET_NOI_WORKER>",
  "zaloBotToken": "<TOKEN_BOT_ZALO>",
  "webhookSecret": "<MA_WEBHOOK_SECRET>",
  "pairingCode": "<MA_PAIR_CODE_1_LAN>"
}
```

### Bước 5: Kết nối bộ tạo ảnh AI cho Video Studio
Video Studio dùng Gemini API để tạo ảnh từng cảnh; Codex/Antigravity vẫn đọc skill, lập storyboard và dựng bằng VieNeu-TTS + Remotion. API key được nhập ẩn và lưu trong `%USERPROFILE%\.codex\video-bot\secrets.json`, không truyền cho tiến trình Codex/Antigravity.

1. Tạo API key trong [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Mở terminal tại `tools/video-bot` và chạy:
   ```bash
   npm run setup:imagegen
   ```
   Dán key tại dấu nhắc; ký tự không hiển thị. Không gửi key vào Zalo, Sheet hoặc chat.
3. Khởi động bộ trực ban bằng `START-STUDIO.cmd`. Giữ máy tính bật khi muốn tạo video; runner sẽ tự nhận yêu cầu mới, tạo tối đa 16 ảnh/cảnh, dựng MP4, kiểm tra và tải lên Drive. Việc đăng Buffer vẫn theo bước duyệt xuất bản trong Studio.

Mặc định dùng `gemini-3.1-flash-lite-image`, ảnh 1K dọc 9:16. Chi phí niêm yết hiện tại khoảng **$0.0336/ảnh 1K** ở paid tier (16 ảnh xấp xỉ $0.54 trước lần thử lại); hạn mức và giá có thể thay đổi. Trên Gemini API free tier, Google có thể dùng nội dung để cải thiện sản phẩm; nếu kịch bản riêng tư, xem xét paid tier trước khi gửi kịch bản/ảnh.

---

## 3. Vận hành hàng ngày (Quy trình Video Studio Web)

### Luồng cộng tác giữa 2 anh em:
1. **Anh trai tại Hà Nội mở Web di động**:
   - Đăng nhập tài khoản `collaborator`.
   - Bấm **Tạo video**, nhập Tiêu đề, Kịch bản, chọn Skill (Kể chuyện TikTok hoặc Linh vật Drama).
   - Bấm **Gửi yêu cầu vào Studio**. Hệ thống tự cấp mã mới (VD: `V002`, `V003`).
2. **Người ở nhà nhận việc trên máy tính**:
   - Khởi chạy `START-STUDIO.cmd` (chỉ cần chạy một lần trong phiên sử dụng; để cửa sổ này mở).
   - Từ đây watcher tự nhận yêu cầu đã gửi từ Web Studio; không cần claim, dựng, upload hoặc đồng bộ bằng tay.
   - Các lệnh CLI thủ công bên dưới chỉ dùng để chẩn đoán/dự phòng:
     ```bash
     node local/cli.mjs studio:pending
     ```
   - Nhận việc yêu cầu (lease token bảo vệ chống nhận trùng):
     ```bash
     node local/cli.mjs studio:claim V002
     ```
   - Chạy kịch bản dựng video và tải MP4 lên Google Drive.
   - Gửi kết quả hoàn tất:
     ```bash
     node local/cli.mjs studio:result V002 <DRIVE_ID> <DRIVE_URL> "[CAPTION]"
     ```
   - Đồng bộ trạng thái vào Google Sheets:
     ```bash
     node local/cli.mjs studio:sync
     ```
3. **Anh trai xem video & duyệt xuất bản trên điện thoại**:
   - Màn hình hiển thị video xem trước 9:16 trực tiếp.
   - Chỉnh sửa Caption / Hashtags nếu cần rồi bấm **Lưu caption**.
   - Chọn các kênh muốn đăng (YouTube Shorts, TikTok, Facebook Reels) và đặt giờ hẹn (nếu có).
   - Bấm **Xác nhận Duyệt & Đăng bài**.
4. **Xuất bản lên Buffer**:
   - Chạy lệnh xuất bản trên máy ở nhà:
     ```bash
     node local/cli.mjs studio:publish
     ```
   - Runner tự động kiểm tra link MP4 (probe media HTTP 200/206 không có cookie Google).
   - Nếu đạt, gửi lên Buffer cho từng kênh độc lập. Kênh nào xong có ngay Post ID và lưu bền vững vào SQLite DO.
   - Khi Buffer hoàn tất, runner tự cập nhật trạng thái `sent` và link bài đăng về giao diện điện thoại.

---

## 4. Các lệnh Zalo Bot (Dự phòng / Kênh cũ)

| Lệnh | Ý nghĩa |
| --- | --- |
| `/pair <CODE>` | Kết nối tài khoản Zalo làm Quản trị viên (1 lần đầu). |
| `/scan` | Quét toàn bộ hàng có Duyệt = "ổn" trên Sheet. |
| `/run V002` | Yêu cầu dựng ngay video có mã ID. |
| `/approve V002` | Duyệt "ổn" cho kịch bản mã ID trực tiếp từ Zalo. |
| `/skill V002 drama-mascot-video` | Đổi skill sản xuất cho video. |
| `/mode V002 auto` | Chuyển chế độ sang "Tự đăng" đa nền tảng. |
| `/status` | Xem danh sách các công việc đang chạy. |
