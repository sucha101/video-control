import os
import sys
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')

def generate_v013_real_evidence():
    job_dir = 'D:/remotion/tasks/video-bot/jobs/studio/V013'
    scenes_dir = os.path.join(job_dir, 'assets', 'scenes')
    os.makedirs(scenes_dir, exist_ok=True)

    img_dũng_path = 'D:/video-control/test_hd_fb.jpg'
    img_tiến_path = 'D:/video-control/fb_2_img_1.jpg'
    img_flow_path = 'D:/video-control/fb_3_img_1.jpg'

    im_dung = Image.open(img_dũng_path)    # 600x600 (ĐD Dũng + Status + Gà AI)
    im_tien = Image.open(img_tiến_path)    # 552x414 (Status Trần Tiến + Gà AI)
    im_flow = Image.open(img_flow_path)    # 526x296 hoặc lớn hơn (Flow vs TGTT)

    print(f"Ảnh Dũng: {im_dung.size}, Ảnh Tiến: {im_tien.size}, Ảnh Flow: {im_flow.size}")

    # Cảnh 1: Toàn cảnh dự án hoạt hình AI đối mặt làn sóng tẩy chay
    # Dùng toàn cảnh infographic Flow vs Thế Giới Trần Trụi
    im_flow.save(os.path.join(scenes_dir, 'scene_01.png'))
    print(" -> scene_01.png: Infographic Flow vs Thế Giới Trần Trụi")

    # Cảnh 2: Đạo diễn Nguyễn Quang Dũng phát biểu: "Ứng dụng AI khi làm phim là xu thế"
    # Crop nửa trái của ảnh im_dung (chân dung đạo diễn và câu phát biểu)
    w, h = im_dung.size
    sc2 = im_dung.crop((0, 0, int(w * 0.55), h))
    sc2.save(os.path.join(scenes_dir, 'scene_02.png'))
    print(" -> scene_02.png: ĐD Nguyễn Quang Dũng phát biểu")

    # Cảnh 3: Bóc phốt hình ảnh nhân vật gà AI trong phim
    # Crop nửa phải của ảnh im_dung (hình ảnh gà 3D AI trong phim)
    sc3 = im_dung.crop((int(w * 0.45), int(h * 0.35), w, h))
    sc3.save(os.path.join(scenes_dir, 'scene_03.png'))
    print(" -> scene_03.png: Cận cảnh gà 3D AI trong trailer")

    # Cảnh 4: Cộng đồng so sánh với phim hoạt hình thủ công (Bảng so sánh Flow vs TGTT)
    # Lấy nửa dưới của im_flow (phần so sánh kinh phí và số người làm)
    wf, hf = im_flow.size
    sc4 = im_flow.crop((0, int(hf * 0.4), wf, hf))
    sc4.save(os.path.join(scenes_dir, 'scene_04.png'))
    print(" -> scene_04.png: Chi tiết bảng so sánh số liệu")

    # Cảnh 5: Nhà sản xuất trần tình - Status "Chuyện về Con Gà AI"
    # Crop góc trên bên phải của im_dung (phần chụp status Facebook của ĐD)
    sc5 = im_dung.crop((int(w * 0.48), 0, w, int(h * 0.55)))
    sc5.save(os.path.join(scenes_dir, 'scene_05.png'))
    print(" -> scene_05.png: Bài đăng Facebook trần tình của ĐD Nguyễn Quang Dũng")

    # Cảnh 6: Tranh cãi nghệ thuật vs AI - Hình ảnh phim Flow (mèo đen đạt Oscar)
    # Crop nửa trái của im_flow (phim hoạt hình Flow)
    sc6 = im_flow.crop((0, 0, int(wf * 0.5), hf))
    sc6.save(os.path.join(scenes_dir, 'scene_06.png'))
    print(" -> scene_06.png: Kiệt tác hoạt hình thủ công Flow đạt Oscar")

    # Cảnh 7: Phản ứng của giới chuyên môn & Netizen - Status Trần Tiến
    # Lấy phần status của im_tien
    wt, ht = im_tien.size
    sc7 = im_tien.crop((0, 0, wt, int(ht * 0.7)))
    sc7.save(os.path.join(scenes_dir, 'scene_07.png'))
    print(" -> scene_07.png: Ý kiến phản biện từ mạng xã hội")

    # Cảnh 8: Bầy gà AI ngơ ngác - Tranh luận chất lượng
    # Lấy phần hình gà 3D của im_tien
    sc8 = im_tien.crop((0, int(ht * 0.55), wt, ht))
    sc8.save(os.path.join(scenes_dir, 'scene_08.png'))
    print(" -> scene_08.png: Bầy gà 3D AI của Thế Giới Trần Trụi")

    # Cảnh 9: Toàn cảnh so sánh Thế Giới Trần Trụi
    im_flow.save(os.path.join(scenes_dir, 'scene_09.png'))
    print(" -> scene_09.png: Tổng quan đối chiếu")

    # Cảnh 10: Toàn cảnh phát biểu đạo diễn & kêu gọi bình luận
    im_dung.save(os.path.join(scenes_dir, 'scene_10.png'))
    print(" -> scene_10.png: Toàn cảnh ĐD Dũng và nhân vật AI")

    print("[SUCCESS] Đã tạo thành công 10 cảnh bằng chứng thực tế từ 3 link Facebook!")

if __name__ == '__main__':
    generate_v013_real_evidence()
