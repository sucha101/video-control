# Thiết kế video “Nợ tiền không trả”

## Mục tiêu

Tạo video kể chuyện đạo lý bằng tiếng Việt cho TikTok, Reels và Shorts từ kịch bản do người dùng cung cấp. Video gồm đúng 16 scene đầu của kịch bản, bỏ scene 17 và bỏ toàn bộ phần promo sách B1–B4.

## Đầu ra

- MP4 dọc `1080x1920`, `30 fps`.
- Thời lượng thực tế được quyết định bởi các file thuyết minh đã tạo, dự kiến khoảng 60 giây.
- Có tiếng thuyết minh tiếng Việt, nhạc nền, hiệu ứng âm thanh tiết chế và caption dễ đọc trên điện thoại.
- Có một ảnh preview đại diện được trích từ bản render cuối.

## Nội dung và thứ tự

- Giữ nguyên nội dung VO và thứ tự scene 1–16 trong kịch bản.
- Scene 17 không xuất hiện.
- Không có nội dung giới thiệu sách hoặc lời kêu gọi mua sách.
- Tiêu đề sử dụng: `NỢ TIỀN KHÔNG TRẢ / LÀ GIEO NGHIỆP NGHÈO HÈN`.
- Scene 16 là card tóm tắt và cũng là cảnh kết thúc:
  1. Có nợ phải trả.
  2. Trả nợ = trả niềm tin.
  3. Trả càng chậm, nợ càng to.

## Hình ảnh

Tạo 16 ảnh scene riêng bằng công cụ tạo ảnh tích hợp. Mỗi ảnh là minh họa dọc 9:16 và tuân thủ khóa phong cách sau:

- Flat 2D vector, stick-figure tối giản.
- Đầu tròn trắng, viền đen dày, mắt chấm, lông mày mảnh, miệng nét đơn giản, không có mũi.
- NHAN mặc hoodie xanh, quần đen, giày trắng, đồng hồ đỏ.
- BAN mặc áo khoác be, quần cargo xanh olive, boots tối màu.
- Cảnh kiếp trước dùng áo nâu thô và dép.
- Thành phố hoặc bối cảnh xanh xám lạnh, ánh đèn spotlight ấm, điểm nhấn vàng.
- Màu phẳng, tối đa một lớp cel shadow; không anime, không 3D, không hiện thực, không watermark và không chữ sinh bởi mô hình ảnh.

Tất cả chữ, tiêu đề và caption được ghép trong Remotion để bảo đảm chính tả tiếng Việt. Ảnh tạo xong được lưu vào thư mục dự án và không phụ thuộc đường dẫn tạm ngoài workspace.

## Thuyết minh và âm thanh

- Dùng VieNeu-TTS cục bộ với giọng `tinhtri` cho toàn bộ 16 scene.
- Mỗi scene có một file WAV riêng.
- Đo thời lượng từng WAV bằng FFprobe và lưu dữ liệu thời lượng thành JSON.
- Mỗi VO được đặt bên trong `Sequence` của scene tương ứng để hình và lời bắt đầu cùng lúc.
- Nhạc nền piano/ambient trầm được lặp ở cấp composition với âm lượng thấp hơn VO rõ rệt.
- SFX dùng tiết chế theo chỉ dẫn scene, ưu tiên những hiệu ứng quan trọng; không để SFX che lời.
- Cuối video có fade âm thanh ngắn, không kéo dài thêm một scene riêng.

## Dựng hình và caption

- Một composition Remotion mới được đăng ký độc lập, không thay đổi hành vi của các composition hiện có.
- Chuyển động ảnh dùng `useCurrentFrame()` và phép toán xác định: zoom khoảng 1–4% kèm pan nhẹ, crop-safe.
- Không sử dụng CSS keyframes.
- Caption được chia thành các cụm ngắn và căn thời gian theo tỷ lệ độ dài cụm trong từng file VO.
- Caption dùng Segoe UI/Arial, weight khoảng 800, màu vàng/amber, có outline hoặc shadow tối vừa phải.
- Caption nằm ở vùng khoảng 65–72% chiều cao, cách mép trái/phải ít nhất 70 px và chừa ít nhất 230 px phía phải cho thanh điều khiển TikTok.
- Hook/tiêu đề dùng chữ trắng đậm ở vùng phía trên, không đặt chữ ở vùng giao diện TikTok dưới cùng.

## Cấu trúc mã nguồn

Tạo module riêng cho video, gồm:

- Dữ liệu 16 scene: VO, caption, đường dẫn ảnh, đường dẫn audio và gợi ý chuyển động.
- Component video chính quản lý timeline và nhạc nền.
- Component scene dùng chung cho ảnh, pan/zoom, overlay, caption và chuyển cảnh.
- JSON thời lượng được sinh từ audio thực tế.
- Script TTS riêng cho dự án này, dựa trên runtime VieNeu-TTS đã có trong workspace.

Mọi file mới dùng tên riêng của video để tránh đụng với các dự án đang tồn tại trong worktree bẩn.

## Xử lý lỗi

- Dừng trước bước render nếu thiếu bất kỳ ảnh hoặc WAV nào trong 16 scene.
- Kiểm tra tổng số scene và tổng số duration entry đều bằng 16.
- Nếu một file TTS lỗi, chỉ tạo lại scene đó thay vì ghi đè toàn bộ tài nguyên đã đạt.
- Nếu ảnh không đúng nhân vật hoặc phong cách, tạo lại riêng ảnh đó với một thay đổi prompt mục tiêu.

## Kiểm thử và nghiệm thu

- Chạy TypeScript/ESLint cho phần mã nguồn liên quan.
- Dùng Remotion để bundle và render composition mới.
- Dùng FFprobe kiểm tra video là `1080x1920`, `30 fps`, có video stream và audio stream, thời lượng phù hợp với tổng timeline.
- Trích các frame đại diện để kiểm tra tiêu đề, caption, safe zone, thứ tự scene và scene kết thúc.
- Nghe/kiểm tra waveform để bảo đảm không có scene cuối bị mất tiếng.

## Ngoài phạm vi

- Không đăng hoặc tải video lên TikTok.
- Không tạo scene 17.
- Không tạo B1–B4 hoặc bất kỳ nội dung promo sách nào.
- Không sửa hoặc dọn các thay đổi không liên quan đang có trong workspace.
