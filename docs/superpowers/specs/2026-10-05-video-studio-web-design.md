# Video Studio — web điều khiển có bước sản xuất cùng Codex

Ngày: 05/10/2026. Phạm vi được người dùng chọn: web tiếp nhận yêu cầu; người dùng nhắn Codex để sản xuất theo skill; người dùng xem, duyệt và đăng qua Buffer.

## 1. Kết quả người dùng cần

Hai người dùng được web trên điện thoại và máy tính. Người dùng nhập tiêu đề, kịch bản, skill và ghi chú; gửi yêu cầu; xem trạng thái; xem video, sửa caption/hashtag; bấm đăng ngay hoặc lên lịch. Codex xử lý các yêu cầu đang chờ khi người dùng nhắn trong chat.

Nút “Gửi yêu cầu” lưu công việc, không tự mở hoặc gửi tin vào phiên Codex. Giao diện giải thích ngắn: “Yêu cầu đã lưu. Nhắn Codex xử lý các bài đang chờ khi bạn sẵn sàng.”

Mặc định video cần duyệt trước khi đăng. Phiên bản đầu không có tự sản xuất hoặc tự đăng ngay sau khi tạo. API tạo ảnh và Zalo không thuộc phạm vi phiên bản này.

## 2. Nền tảng và nguồn dữ liệu

- Tận dụng Cloudflare Worker hiện có `tools/video-bot/cloud`, thêm web responsive tiếng Việt cùng origin.
- Thêm bảng SQLite trong Durable Object hiện có bằng migration cộng thêm, giữ dữ liệu hàng đợi hiện có.
- Cloud là nguồn dữ liệu chính của yêu cầu web. Sheet là bản đồng bộ để theo dõi; lỗi đồng bộ Sheet không xóa công việc trên web.
- Google OAuth, Buffer credential và runner credential ở bộ chạy Windows hoặc Worker secret phù hợp, không đưa vào mã frontend, HTML hoặc trình duyệt.
- Video lưu ở thư mục Drive đã có. Web dùng iframe preview Drive, có nút mở Drive khi trình duyệt không phát inline.
- Người dùng vẫn xem/gửi yêu cầu khi máy ở nhà tắt; upload, đồng bộ Google và gửi Buffer chờ máy bật cùng bộ chạy.

Worker phục vụ tài nguyên tĩnh và API web. API runner dùng bearer riêng như hiện có. API web có session riêng, không sử dụng runner token trong trình duyệt.

## 3. Đăng nhập

Hai tài khoản riêng: chủ hệ thống và cộng tác viên. Cả hai được gửi yêu cầu, xem kết quả, duyệt đăng; quản lý cấu hình và tài khoản chỉ dành cho chủ hệ thống.

Tài khoản tạo bằng lệnh thiết lập ngoài web, không có đăng ký công khai. Mật khẩu lưu dưới dạng hash PBKDF2 với salt ngẫu nhiên, số vòng theo hướng dẫn hiện hành được xác minh lúc triển khai. Mỗi phiên dùng token ngẫu nhiên; cơ sở dữ liệu chỉ giữ hash; cookie HttpOnly, Secure, SameSite=Strict, thời hạn 7 ngày. Logout thu hồi phiên. Không lưu mật khẩu hay token trong localStorage.

API thay đổi dữ liệu kiểm tra origin và CSRF token gắn với phiên. Đăng nhập có giới hạn thử lại; thông báo lỗi không tiết lộ tài khoản tồn tại. Tài nguyên ứng dụng có thể công khai; tất cả API và nội dung công việc cần đăng nhập. Nội dung kịch bản và caption được hiển thị dưới dạng text, không HTML tùy ý.

## 4. UI/UX: thiết kế ưu tiên điện thoại

Ứng dụng dùng tiếng Việt và ưu tiên điện thoại. Hướng thị giác đề xuất là **sổ gọi cảnh của một đội sản xuất video nhỏ**: trật tự và ghi chú của tờ call sheet được biến thành giao diện số, mỗi video đi qua “Yêu cầu → Codex dựng → Bạn duyệt → Đăng”. Dùng nền giấy ngà `#F4F1E9`, chữ mực xanh than `#182A31`, màu san hô đất `#C84E3A` cho hành động chính và dấu cần chú ý; màu trạng thái luôn có nhãn chữ và biểu tượng. Chữ giao diện dùng Be Vietnam Pro để hiển thị tiếng Việt rõ; tiêu đề và số thứ tự có phân cấp đậm nhẹ, các cột trạng thái dùng số canh đều. Cảm giác làm phim đến từ dòng tiến độ, mốc cảnh và ghi chú biên tập thật; không dùng poster giả, dashboard KPI, bóng đổ dày, hay những tấm card lặp lại. Đây là hướng được đề xuất sau khi người dùng giao Codex đề xuất nhận diện; cần người dùng duyệt trước khi dựng giao diện.

Trên điện thoại có thanh điều hướng dưới cùng với hai mục “Video” và “Tạo video”; tài khoản nằm trong menu trang. Trên desktop chuyển thành thanh bên trái, nội dung giữa trang có độ rộng giới hạn. Danh sách dùng các hàng phân cách mảnh, trạng thái nằm trong một trục dọc để mắt quét nhanh thay cho lưới thẻ. Nút chính cao tối thiểu 48px, trường nhập có nhãn luôn hiện, tương phản dễ đọc. Khi gửi, nút đổi sang trạng thái đang gửi để tránh bấm hai lần; lỗi hiển thị cạnh trường cần sửa và giữ nguyên nội dung đã nhập.

### Màn “Tạo video”

Thứ tự trường theo việc người dùng cần làm: tiêu đề; kịch bản (vùng nhập lớn, có đếm ký tự); chọn skill bằng hai hàng lựa chọn có mô tả một câu; giọng đọc và tư liệu tham chiếu nằm trong phần “Tùy chọn”; ghi chú; nút cố định ở cuối màn hình “Gửi yêu cầu”. Không yêu cầu ID video hoặc hiểu trạng thái queue. Sau khi gửi, hiện mã yêu cầu, xác nhận nội dung đã lưu và nút “Xem tiến độ”. Dòng hướng dẫn luôn nói rõ muốn tạo video thì nhắn Codex xử lý bài đang chờ.

```text
┌──────────────────────────┐
│ Video Studio        ● máy│
│ Tạo video                │
│ Tiêu đề                  │
│ [______________________] │
│ Kịch bản                 │
│ [                      ] │
│ [       nhập nội dung  ] │
│ Chọn phong cách          │
│ [ Kể chuyện ] [ Mascot ] │
│ Tùy chọn ▾               │
│                          │
│ [      Gửi yêu cầu      ]│
└──────────────────────────┘
```

### Màn “Video”

Màn mặc định mở vào danh sách, tiêu đề trang kèm nút “+ Tạo video”. Bộ lọc dạng chip: “Tất cả”, “Đang chờ”, “Cần duyệt”, “Đã đăng”. Mỗi thẻ có tiêu đề, skill, ngày cập nhật, nhãn trạng thái viết rõ và một dòng tiến độ gần nhất, ví dụ “Đã gửi yêu cầu — chờ bạn nhắn Codex xử lý” hoặc “Video đã xong — chờ bạn duyệt”. Không hiện ID kỹ thuật hoặc JSON trên thẻ. Có màn rỗng với nút tạo đầu tiên; có skeleton khi tải và nút thử lại khi lỗi mạng.

### Màn chi tiết, xem và đăng

Trên đầu: tiêu đề, nhãn trạng thái tạo và trạng thái đăng riêng. Bên dưới: video xem được trên trang; nếu preview Drive không chạy thì nút rõ “Mở video trong Drive”. Tiếp đến caption và hashtag có thể sửa, rồi kết quả theo từng kênh. Nút chính chỉ xuất hiện khi video đã sẵn sàng: “Duyệt & chọn đăng”. Màn xác nhận cho phép tick từng kênh, chọn “Đăng ngay” hoặc lịch, và xem trước caption; dòng chú thích nhắc video chỉ gửi lên Buffer sau khi xác nhận. Sau đó mỗi kênh có trạng thái riêng “Đang gửi”, “Đã lên lịch”, “Đã đăng” hoặc “Cần kiểm tra” cùng link kết quả nếu có.

Không tự đổi “Đã gửi Buffer” thành “Đã đăng”; dùng thông báo thành công/thất bại dễ hiểu, còn ID Buffer chỉ để trong phần chi tiết kỹ thuật tùy chọn. Nếu có lỗi tạm thời, nút thử lại chỉ hiện khi đã xác định thao tác trước đó chưa tạo bài; trường hợp chưa rõ kết quả thì hiển thị “Cần kiểm tra” và chặn thử lại để tránh đăng trùng.

### Trạng thái trực quan

Trạng thái tạo: “Đang chờ Codex”, “Đang làm”, “Chờ bạn duyệt”, “Cần kiểm tra”, “Đã hủy”. Trạng thái đăng cho từng kênh: “Chưa gửi”, “Đang gửi”, “Đã lên lịch”, “Đã đăng”, “Cần kiểm tra”. Dấu chấm máy chỉ báo máy dựng có heartbeat gần đây; kèm chú giải “Máy dựng đang bật”/“Máy dựng chưa kết nối”. Màu trạng thái đi kèm nhãn chữ, biểu tượng và vị trí nhất quán.

## 5. Nội dung và thao tác trên các màn

### Gửi yêu cầu

Tiêu đề, kịch bản, skill (hai lựa chọn `viet-tiktok-story-video`, `drama-mascot-video`), giọng đọc tùy chọn, tư liệu tham chiếu và ghi chú. Mặc định giọng hiện có, không yêu cầu người dùng nhập đường dẫn máy tính. Kiểm tra trường bắt buộc, độ dài và skill trong danh sách cho phép. Tư liệu nhập bằng link HTTPS, phiên bản đầu chưa nhận upload tệp.

### Danh sách video

Thẻ hoặc bảng thích ứng màn hình: mã, tiêu đề, skill, trạng thái, thời điểm cập nhật. Bộ lọc chờ tạo/đang tạo/chờ duyệt/đã gửi đăng/cần kiểm tra. Nút tạo yêu cầu nổi bật. Máy dựng hiển thị “Có kết nối gần đây” hoặc “Chưa có kết nối gần đây”, dựa vào heartbeat; không khẳng định có người đang mở Codex.

### Chi tiết và duyệt đăng

Kịch bản và ghi chú, video Drive, caption và hashtag có thể sửa, kết quả từng kênh. Chọn kênh YouTube/TikTok/Facebook; chọn đăng ngay hoặc giờ theo Asia/Bangkok (UTC+7); tóm tắt nội dung và lịch ngay cạnh nút xác nhận. Giờ hẹn đã qua được từ chối.

Hai trạng thái độc lập: sản xuất video và xuất bản từng kênh. “Đã gửi Buffer” không được hiển thị thành “Đã đăng”. Khi Buffer trả `sent`, mới ghi “Đã đăng” và link bài.

## 6. Dữ liệu và phiên bản nội dung

Mỗi yêu cầu có ID UUID nội bộ và mã video hiển thị do cloud cấp tăng dần trong transaction, tránh trùng V001 đã có. Import V001 từ Sheet qua lệnh đọc và upsert trước khi cấp mã mới; không đăng lại V001.

Trạng thái sản xuất: `waiting`, `producing`, `review`, `needs_review`, `cancelled`. Mỗi bản kịch bản có revision và hash gồm tiêu đề, kịch bản, skill, giọng đọc, tư liệu, ghi chú. Caption/hashtag có revision riêng.

Cho phép sửa/hủy yêu cầu đang chờ. Khi sản xuất, khóa chỉnh sửa đầu vào; muốn đổi nội dung phải đưa lại về cần kiểm tra và tạo revision mới có xác nhận của người dùng. Đổi caption sau sản xuất không yêu cầu render lại. Video đã gửi đăng vẫn giữ bản nội dung đã gửi trong lịch sử.

## 7. Codex sản xuất theo yêu cầu trong chat

Thêm công cụ Node trong package để Codex lấy danh sách, nhận một yêu cầu và ghi tiến độ/kết quả. Các lệnh dùng credential riêng trên máy, không chứa bí mật trong tham số shell hoặc log.

Khi người dùng nhắn “Xử lý các bài đang chờ”, Codex đọc danh sách qua công cụ, nhận từng yêu cầu bằng transaction, đọc skill tại đường dẫn được cấu hình trong máy, tạo tài nguyên bằng các công cụ phiên chat, TTS và Remotion. Đường dẫn skill không được lấy tùy ý từ input web.

Việc nhận yêu cầu có lease 180 giây, fencing token và heartbeat tự động qua helper giữ chạy trong suốt công việc. Mất lease phải ngừng side effect và đưa về cần kiểm tra, không tự tạo lại. Kết quả bao gồm MP4, báo cáo kỹ thuật, caption, hashtags. Dùng ffprobe xác minh file trước upload, lưu checkpoint upload để chạy lại không tạo bản sao vô điều kiện.

Sau upload thành công, cập nhật cloud thành chờ duyệt, rồi đồng bộ Sheet. Helper lưu manifest job bền vững để khôi phục khi tắt máy. Video và Drive ID gắn với revision đã nhận; stale token không được cập nhật kết quả.

## 8. Đăng bài và chống trùng

Nút duyệt đăng tạo publication có ID ổn định và snapshot của Drive file, caption, hashtags, kênh và lịch. Bấm hai lần cùng yêu cầu không tạo hai publication. Máy nhận việc đăng qua queue có lease.

Lưu intent vào SQLite trước mỗi lần gọi Buffer. Sau khi Buffer trả ID, lưu ID/trạng thái ngay cho từng kênh, đồng bộ Sheet sau đó. Không sử dụng các callback `save` và `fence` rỗng như luồng hiện có.

Nếu request timeout hoặc máy tắt sau khi gửi mà chưa lưu được ID, kênh đó chuyển cần kiểm tra và không tự gửi lại. Hai kênh còn lại giữ kết quả riêng. Không hứa exactly-once khi nhà cung cấp chưa hỗ trợ idempotency; tránh retry vô điều kiện khi kết quả chưa rõ.

Trước side effect, kiểm tra lease và snapshot duyệt vẫn hợp lệ. Poll Buffer theo ID để cập nhật `sending`/`sent`/lỗi và link bài. URL media phải truy cập được bởi Buffer, không chỉ là trang xem Drive; xác minh khả năng tải MP4 trước đăng.

## 9. Quyền Drive và vận hành

Không cần quyền anyone writer để xem hoặc để Buffer tải video. Video mới cấp quyền anyone reader khi cần dùng public media. Không đổi quyền file/folder cũ trong quá trình tạo web; báo rõ trường hợp hiện có quyền rộng khi kiểm tra cấu hình.

START/STOP phải quản lý đúng tiến trình có PID, kiểm tra khóa còn sống; STOP không chỉ xóa lock. Hiển thị lỗi có thể xử lý và thời gian cập nhật trên web; không trả lỗi thô có credentials. Bản đầu không cần thông báo email/Zalo.

## 10. Điều kiện nghiệm thu

1. Hai tài khoản đăng nhập trên mobile; người chưa đăng nhập không đọc/sửa yêu cầu hay cấu hình.
2. Gửi/sửa yêu cầu, chọn đúng skill; bấm gửi lặp không sinh bản sao.
3. Hai helper tranh nhận một yêu cầu: chỉ một nhận được; stale lease không ghi kết quả/upload/đăng.
4. Codex nhận một yêu cầu do người dùng cho phép, cập nhật tiến độ và kết quả thật; việc gửi web riêng không kích hoạt Codex CLI dựng video.
5. Xem MP4 trên web/Drive, chỉnh caption, duyệt lịch đúng UTC+7.
6. Kiểm thử đăng bằng adapter giả cho double-click, timeout, restart và một kênh thất bại; không gửi bài thật chỉ để kiểm thử giao diện.
7. Video đã đăng hiển thị link thật từ Buffer; Sheet lỗi không mất ID biên nhận.
8. Khi offline, web giữ yêu cầu và publication; khi máy bật xử lý tiếp đúng trạng thái.

## 11. Thứ tự triển khai

Đầu tiên làm đăng nhập, lưu yêu cầu và ba màn hình; tiếp theo nối helper Codex và đồng bộ Sheet/Drive; cuối cùng nối duyệt đăng, lưu biên nhận và khôi phục tiến trình. Mỗi bước cần kiểm tra riêng trước khi deploy. Giữ API Zalo cũ tương thích nhưng web không phụ thuộc việc ghép đôi Zalo.
