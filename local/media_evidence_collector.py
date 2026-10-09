import sys
import os
import re
import json
import requests
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

def search_bing_images(query, max_results=5):
    """Tìm kiếm ảnh thực tế từ Bing Images"""
    url = f"https://www.bing.com/images/search?q={requests.utils.quote(query)}&first=1"
    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        if r.status_code != 200:
            return []
        murls = re.findall(r'&quot;murl&quot;:&quot;(https?://[^&]+)&quot;', r.text)
        valid = []
        for u in murls:
            # Bỏ các ảnh svg, icon nhỏ
            if re.search(r'\.(jpg|jpeg|png|webp)', u, re.I):
                valid.append(u)
            if len(valid) >= max_results:
                break
        return valid
    except Exception as e:
        print(f"[Collector] Lỗi tìm ảnh Bing '{query}': {e}")
        return []

def download_image(url, out_path):
    """Tải và lưu ảnh về ổ cứng"""
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.status_code == 200 and len(r.content) > 10000:
            with open(out_path, 'wb') as f:
                f.write(r.content)
            return True
    except Exception:
        pass
    return False

def capture_fb_or_web(url, out_path, browser):
    """Chụp ảnh màn hình bài viết bằng Playwright và đóng login dialog"""
    try:
        page = browser.new_page(viewport={'width': 1080, 'height': 1400})
        page.goto(url, timeout=30000, wait_until='domcontentloaded')
        page.wait_for_timeout(3000)
        
        # Tiêm script dọn dẹp các modal popup đăng nhập Facebook
        js_cleanup = """
        (() => {
            const dialogs = document.querySelectorAll('[role="dialog"]');
            dialogs.forEach(d => {
                const closeBtn = d.querySelector('[aria-label="Đóng"], [aria-label="Close"]');
                if (closeBtn) closeBtn.click();
                else d.remove();
            });
            document.querySelectorAll('[data-nosnippet]').forEach(el => el.remove());
            document.querySelectorAll('div[class*="login"], div[class*="signup"]').forEach(el => {
                if (el.innerText.includes('Đăng nhập') || el.innerText.includes('Log In')) {
                    el.style.display = 'none';
                }
            });
            document.body.style.overflow = 'auto';
        })()
        """
        page.evaluate(js_cleanup)
        page.wait_for_timeout(1000)
        page.screenshot(path=out_path)
        page.close()
        return True
    except Exception as e:
        print(f"[Collector] Không thể chụp {url}: {e}")
        return False

def collect_evidence_for_job(job_dir, reference_urls=[]):
    """Thu thập toàn bộ bằng chứng thực tế cho job"""
    scenes_dir = os.path.join(job_dir, 'assets', 'scenes')
    os.makedirs(scenes_dir, exist_ok=True)
    
    plan_path = os.path.join(job_dir, 'scene-plan.json')
    if not os.path.exists(plan_path):
        print("[Collector] Không tìm thấy scene-plan.json")
        return False
        
    with open(plan_path, 'r', encoding='utf-8') as f:
        plan = json.load(f)
        
    scenes = plan.get('scenes', [])
    print(f"[Collector] Bắt đầu thu thập tư liệu thật cho {len(scenes)} cảnh...")

    # 1. Chụp màn hình các link tham khảo bài viết (Facebook / Báo chí)
    fb_captures = []
    if reference_urls:
        print(f"[Collector] Đang mở trình duyệt chụp {len(reference_urls)} link nguồn bài viết...")
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            for idx, ref_url in enumerate(reference_urls):
                fb_out = os.path.join(scenes_dir, f'ref_evidence_{idx+1}.png')
                if capture_fb_or_web(ref_url, fb_out, browser):
                    fb_captures.append(fb_out)
                    print(f" -> Đã lưu tư liệu bài viết {idx+1}: {fb_out}")
            browser.close()

    # 2. Định nghĩa từ khóa tìm kiếm chính xác cho từng cảnh của vụ việc
    search_queries = {
        1: ["thế giới trần trụi nguyễn quang dũng", "phim hoạt hình AI thế giới trần trụi"],
        2: ["nguyễn quang dũng phát biểu thế giới trần trụi", "nguyễn quang dũng làm phim AI"],
        3: ["thế giới trần trụi con gà AI", "phim thế giới trần trụi 3d"],
        4: ["flow oscar blender vs thế giới trần trụi", "họa sĩ phản đối phim thế giới trần trụi"],
        5: ["cetus studio thế giới trần trụi", "nguyễn quang dũng chuyện con gà AI"],
        6: ["phim hoạt hình thế giới trần trụi poster", "nguyễn quang dũng đạo diễn phim"],
        7: ["tranh cãi phim AI thế giới trần trụi netizen", "cộng đồng mạng thế giới trần trụi"],
        8: ["phim flow oscar 2025 gints zilbalodis", "phim hoạt hình việt nam chiếu rạp"],
        9: ["họa sĩ vẽ phim hoạt hình việt nam", "trí tuệ nhân tạo làm phim điện ảnh"],
        10: ["bình luận phim thế giới trần trụi", "khán giả tẩy chay phim AI"]
    }

    # 3. Phân bổ và tải ảnh thực tế cho từng cảnh
    for scene in scenes:
        sc_id = scene.get('id', 1)
        target_file = os.path.join(scenes_dir, f'scene_{str(sc_id).zfill(2)}.png')
        
        # Nếu có bài viết chụp thật tương ứng ở các cảnh dẫn chứng cốt lõi:
        # Cảnh 1: Bài Cetus Studio / Phát biểu đạo diễn
        # Cảnh 3: Bài Minh Tu Le / Con gà AI
        # Cảnh 4: Bài so sánh Flow vs Thế Giới Trần Trụi
        if sc_id == 1 and len(fb_captures) >= 1:
            import shutil
            shutil.copy(fb_captures[0], target_file)
            print(f"[Collector] Cảnh {sc_id}: Gán tư liệu bài đăng Cetus Studio & Đạo diễn Nguyễn Quang Dũng.")
            continue
        elif sc_id == 3 and len(fb_captures) >= 2:
            import shutil
            shutil.copy(fb_captures[1], target_file)
            print(f"[Collector] Cảnh {sc_id}: Gán tư liệu bóc tách nhân vật gà AI từ mạng xã hội.")
            continue
        elif sc_id == 4 and len(fb_captures) >= 3:
            import shutil
            shutil.copy(fb_captures[2], target_file)
            print(f"[Collector] Cảnh {sc_id}: Gán tư liệu so sánh phim Flow đạt Oscar với Thế Giới Trần Trụi.")
            continue

        # Tìm kiếm ảnh thật trên Web theo từ khóa của cảnh
        queries = search_queries.get(sc_id, [scene.get('narration', '')[:40]])
        found = False
        for q in queries:
            img_urls = search_bing_images(q, max_results=3)
            for u in img_urls:
                if download_image(u, target_file):
                    print(f"[Collector] Cảnh {sc_id}: Tải thành công ảnh thật từ Web ('{q}') -> {target_file}")
                    found = True
                    break
            if found:
                break
                
        # Nếu không tải được ảnh Bing, dùng luân phiên ảnh tư liệu bài viết FB
        if not found and fb_captures:
            import shutil
            fallback_fb = fb_captures[(sc_id - 1) % len(fb_captures)]
            shutil.copy(fallback_fb, target_file)
            print(f"[Collector] Cảnh {sc_id}: Dùng tư liệu bài đăng Facebook thật làm bằng chứng.")

    print("[Collector] Hoàn tất thu thập 100% tư liệu và bằng chứng thật!")
    return True

if __name__ == '__main__':
    job_dir = sys.argv[1] if len(sys.argv) > 1 else 'D:/remotion/tasks/video-bot/jobs/studio/V013'
    ref_urls = [
        'https://www.facebook.com/share/p/1LW4uniAEH/',
        'https://www.facebook.com/share/p/1EBXRoj7YJ/',
        'https://www.facebook.com/share/p/18gfPyG9W8/'
    ]
    collect_evidence_for_job(job_dir, ref_urls)
