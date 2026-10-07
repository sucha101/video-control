# Video Studio — điều hướng, trải nghiệm và phục hồi công việc

Ngày 05/10/2026. Đặc tả bổ sung cho web đang hoạt động; kế thừa hướng thiết kế “Sổ gọi cảnh” và luồng có người cùng Codex xử lý video.

## Mục tiêu sử dụng

Người dùng mở đúng bài từ URL, nhấn Back/Forward/F5 theo cách quen thuộc, giữ đăng nhập và nội dung đang nhập, hiểu video đang ở bước nào và cần làm gì tiếp. Khi máy local hoặc dịch vụ bị gián đoạn, giao diện giải thích được việc đang chờ mà không tạo thêm video/bài đăng.

## Hiện trạng có bằng chứng

| Quan sát | Bằng chứng trong mã | Kết luận |
| --- | --- | --- |
| Màn tạo và chi tiết cùng URL `/studio` | `cloud/web/app.js`, `switchView`: mọi view khác login đều ánh xạ `/studio` | Router chưa mô tả từng màn hình; không mở thẳng hoặc phục hồi đúng màn sau tải lại. |
| Nút Back không phục hồi màn trước | `popstate` luôn gọi view list với mọi đường dẫn khác `/login` | Lỗi điều hướng đã xác nhận từ mã. |
| Có thể về login khi mạng lỗi | `initSession` catch mọi lỗi rồi `showLoginView`; hàm này xóa auth state client | Timeout/5xx và hết phiên bị gộp chung. Việc người dùng bị login sau Back cần tái hiện cả history và page restore để xác định nhánh thực tế. |
| Login còn nằm trong history | Login thành công gọi `switchView('list')` với push mặc định | Cần thay entry login khi xác thực thành công, thay vì thêm một entry phía sau. |
| Không lưu nháp bền vững | `app.js` chưa có draft storage/page lifecycle | Có thể mất kịch bản/caption sau tải lại, đóng tab hoặc hết phiên. |
| Nhãn trạng thái chưa phủ lỗi từng kênh | Tổng hợp SQL còn gộp nhiều trạng thái vào `publishing` | V003 có kênh chưa rõ kết quả không nên hiện như đang tiến triển bình thường. |
| V002 hiển thị không nhất quán trước sửa | API detail trước đây thiếu `publication_state`; đã bổ sung và triển khai | Dùng một cách tổng hợp duy nhất; trạng thái `accepted` chưa xác nhận bài đã đăng. |
| Health xanh có thể chậm phản ánh máy tắt | `queue.mjs` cho online tới 900.000ms sau lastSeen | Giảm ngưỡng, kèm thời điểm liên lạc; kết nối không chứng minh Codex đang tạo ảnh/render. |
| Phục hồi upload Drive mới chỉ kiểm tra cú pháp | Bản sửa checkpoint/chunk chưa có kiểm thử gián đoạn; identity hiện dựa fingerprint kịch bản | Phải ràng buộc checksum MP4 và kiểm tra phục hồi trước khi coi uploader ổn định. |

41 kiểm thử đạt trong đợt audit trước không chứng minh Back/Forward/BFCache, mất nháp hay upload bị ngắt đã đúng. Không coi mọi lỗi đăng nhập là do cookie: cookie hiện được đặt 30 ngày, HttpOnly, Secure và SameSite.

## Đường dẫn và lịch sử trình duyệt

Một tên miền chung `https://zalo-video-control.datnthe.workers.dev`. Đường dẫn cho màn hình:

| URL | Nội dung | Tiêu đề tab |
| --- | --- | --- |
| `/login` | Đăng nhập | Đăng nhập · Video Studio |
| `/studio` | Danh sách video | Video của tôi · Video Studio |
| `/studio?status=review` | Danh sách đã lọc | Cần duyệt · Video Studio |
| `/studio/new` | Nhập kịch bản | Tạo video · Video Studio |
| `/studio/videos/V002` | Preview, caption, tiến độ và biên nhận | V002 — tiêu đề video · Video Studio |
| `/studio/videos/V002/publish` | Xác nhận nội dung, kênh và giờ đăng | Xác nhận đăng V002 · Video Studio |
| `/studio/system` | Tình trạng kết nối và công việc chờ | Kết nối hệ thống · Video Studio |

`Vxxx` là display ID ổn định và đọc được; UUID vẫn dùng trong API/biên nhận. Dialog ngắn và các thao tác lưu không bắt buộc URL riêng. Root `/` chuẩn hóa tới `/studio` sau xác thực, không làm mất deep link.

- Điều hướng có chủ ý giữa màn hình dùng push; sửa URL chuẩn, chuyển login sau hết phiên và login thành công dùng replace.
- Back/Forward phục hồi route, bộ lọc, vị trí cuộn và nháp. Không tự thêm history để giữ người dùng trong ứng dụng.
- Tải trực tiếp/F5 tại một URL phải phục hồi đúng màn hình. Route không hợp lệ có trang “Không tìm thấy” với lối về danh sách.
- Chưa login: `/login?next=<đường dẫn nội bộ hợp lệ>`. Sau login quay về đúng URL, không nhận next khác origin hoặc `//...`.
- Xác thực còn hạn: Back tới một entry login trong app phải render màn có quyền hoặc chuẩn hóa lại; không yêu cầu nhập mật khẩu lại chỉ vì đổi đường dẫn.

## Phiên và dữ liệu người dùng

Auth có bốn trạng thái: `checking`, `authenticated`, `guest`, `unavailable`. Timeout/5xx hiển thị “Chưa kiểm tra được đăng nhập — Thử lại”, giữ URL và nháp. Chỉ kết quả server xác nhận unauthenticated/401 hoặc logout thành công mới chuyển guest. Không để dữ liệu phiên trước lộ cho tài khoản khác.

Giữ cookie 30 ngày hiện có. Không lưu mật khẩu/token trong localStorage. Lưu draft theo username; script draft và caption draft của video khác nhau. Draft tự lưu sau 500ms, có ngày lưu, TTL 7 ngày, nút khôi phục/xóa. Lỗi dung lượng trình duyệt phải có thông báo để người dùng biết nháp chưa được lưu.

Kiểm tra phiên khi `pageshow.persisted`, quay lại tab hoặc tab khác đăng xuất; coalesce request, không tạo vòng kiểm tra liên tục. Logout qua một tab phải làm các tab khác xóa dữ liệu hiển thị nhạy cảm và bảo vệ các thao tác đang mở.

## Trạng thái có ý nghĩa với người dùng

Tách tiến độ dựng và tiến độ đăng. Một `publicationSummary` dùng chung cho list/detail, có tổng kênh, số đã đăng, trạng thái cần hành động, thời điểm kiểm tra gần nhất và thời điểm kiểm tra tiếp theo.

- `waiting`: “Đã lưu — chờ xử lý”; thao tác “Sao chép yêu cầu để nhắn Codex”.
- `producing`: bước thực đã báo về; không tự mô tả tạo ảnh chỉ dựa trên heartbeat.
- `review` chưa có publication: “Video xong — cần duyệt”; thao tác “Xem và chọn kênh đăng”.
- `accepted`: “Buffer đã nhận — chờ xác nhận đăng”; hiện lần kiểm tra gần nhất.
- `sent`: “Đã đăng n/n kênh”; link khi provider trả link, vẫn ghi sent nếu provider xác nhận sent nhưng chưa có link.
- Một phần sent: “Đã đăng x/n kênh”; kênh còn lại có nhãn riêng.
- `needs_review` hoặc gửi cũ không có lease/ID: “Cần kiểm tra trước khi gửi lại”; không hiện tiến trình đang chạy.
- `failed_confirmed`: giải thích lỗi từng kênh và chỉ hiện thao tác được policy cho phép.
- Quota bị khóa: hiện thời điểm có thể kiểm tra/gửi tiếp theo từ dữ liệu runtime đã lưu; không đặt thời gian phục hồi cố định trong UI.

Không đánh dấu V002 đã đăng chỉ dựa trên lời gọi create được chấp nhận. Không gửi lại V003 khi chưa đối soát. Manual confirmation, nếu triển khai, phải có actor, thời điểm và nguồn xác nhận riêng với provider confirmation.

## UX và khả năng tiếp cận

Giữ màu/kiểu chữ đã chọn: nền `#F4F1E9`, chữ `#182A31`, coral `#C84E3A`, Be Vietnam Pro. Tập trung hành vi trước thay đổi trang trí.

- Navigation/card có link thật: có thể Tab, Enter, copy link và mở tab mới.
- Trường chính là “Tiêu đề video”, “Kịch bản”, “Phong cách”; tùy chọn giọng/tham khảo/ghi chú có thể thu gọn.
- Nút gửi ghi “Gửi kịch bản”; thông báo sau gửi có mã bài và bước tiếp theo. Sau response, chuyển ngay tới URL bài vừa tạo, không timer tự chuyển danh sách.
- Caption chưa lưu có nhãn rõ; khôi phục sau đổi tab/tải lại. Confirmation page hiển thị snapshot caption, 3 kênh mặc định chọn, giờ UTC+7 và cảnh báo lịch đã qua.
- Loading, empty, network failure, video không preview được đều có hành động cụ thể. Thay alert thường xuyên bằng feedback inline/toast có aria-live.
- Mobile 320/390px không tràn ngang, nút chạm tối thiểu 44px; desktop 768/1024/1440px không làm textarea cao vô ích. Focus chuyển tới tiêu đề khi đổi màn và trở lại link video khi Back.
- Máy “kết nối gần đây” và “đang dựng video” là hai thông tin khác nhau. Nhóm người dùng không cần nhìn token, đường dẫn local hay stack trace.

## Giới hạn vận hành

Native ESM, Worker + SQLite Durable Object hiện có, Node >=22. Không nâng framework để giải quyết router. Bảng/migration cộng thêm, không đổi DO identity `personal-v1`, V001 giữ read-only, không tạo bài thật để kiểm thử.

UI chỉ đọc trạng thái đã lưu trong cloud. Mở trang, chuyển filter hoặc nhấn refresh không trực tiếp gọi Buffer. Buffer dùng ledger hiện có, giới hạn đọc/ghi và Retry-After. Mỗi task phải bảo vệ idempotency, expiry/fence và dữ liệu chưa commit hiện có.

## Tài liệu kỹ thuật đã kiểm tra

- [MDN: History API](https://developer.mozilla.org/en-US/docs/Web/API/History_API/Working_with_the_History_API): push/replace/popstate và kỳ vọng Back/Forward.
- [MDN: pageshow](https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event): page restore và BFCache.
- [MDN: Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch): lỗi mạng khác HTTP response lỗi.
- [Cloudflare: SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/): navigation fallback; API và asset thật vẫn phải được phân biệt.
