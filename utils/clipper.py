import os
import sys
import json
import subprocess
import numpy as np

def check_drawtext_support(ffmpeg_path):
    try:
        cmd = [ffmpeg_path or 'ffmpeg', '-filters']
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        return 'drawtext' in result.stdout
    except Exception:
        return False

def get_video_specs(ffprobe_path, filepath):
    try:
        cmd = [
            ffprobe_path or 'ffprobe', '-v', 'error', 
            '-select_streams', 'v:0', 
            '-show_entries', 'stream=width,height,r_frame_rate,duration', 
            '-of', 'json', filepath
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        data = json.loads(result.stdout)
        stream = data.get('streams', [{}])[0]
        
        width = int(stream.get('width', 0))
        height = int(stream.get('height', 0))
        duration = float(stream.get('duration', 0.0))
        
        fps_str = stream.get('r_frame_rate', '30/1')
        if '/' in fps_str:
            num, den = map(int, fps_str.split('/'))
            fps = num / den if den > 0 else 30.0
        else:
            fps = float(fps_str)
            
        return width, height, duration, fps
    except Exception as e:
        sys.stderr.write(f"Error in get_video_specs: {str(e)}\n")
        return 0, 0, 0.0, 30.0

def get_crop_center(t, crops, W, H):
    if not crops:
        return W // 2, H // 2, None
    
    crops_sorted = sorted(crops, key=lambda x: x['time'])
    
    if t <= crops_sorted[0]['time']:
        c = crops_sorted[0]
        return int(c['cx'] * W), int(c['cy'] * H), c.get('landmarks')
    if t >= crops_sorted[-1]['time']:
        c = crops_sorted[-1]
        return int(c['cx'] * W), int(c['cy'] * H), c.get('landmarks')
        
    for i in range(len(crops_sorted) - 1):
        c0, c1 = crops_sorted[i], crops_sorted[i+1]
        t0, t1 = c0['time'], c1['time']
        if t0 <= t <= t1:
            raw_alpha = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
            # Smoothstep easing (3*a^2 - 2*a^3) untuk pergerakan kamera yang lebih mulus dan tidak patah
            alpha = raw_alpha * raw_alpha * (3 - 2 * raw_alpha)
            cx = c0['cx'] + alpha * (c1['cx'] - c0['cx'])
            cy = c0['cy'] + alpha * (c1['cy'] - c0['cy'])
            
            l0, l1 = c0.get('landmarks'), c1.get('landmarks')
            landmarks = None
            if l0 and l1:
                landmarks = {}
                for k in l0.keys():
                  if k in l1:
                    landmarks[k] = [
                        l0[k][0] + alpha * (l1[k][0] - l0[k][0]),
                        l0[k][1] + alpha * (l1[k][1] - l0[k][1])
                    ]
            elif l0:
                landmarks = l0
            elif l1:
                landmarks = l1
                
            return int(cx * W), int(cy * H), landmarks
            
    return W // 2, H // 2, None

def merge_multi_range_audio(ffmpeg_path, original_path, time_ranges, cropped_video_path, audio_enhance=False):
    temp_dir = os.path.dirname(cropped_video_path)
    import uuid
    uid = uuid.uuid4().hex
    concat_list_path = os.path.join(temp_dir, f"list_{uid}.txt")
    temp_audios = []
    
    try:
        with open(concat_list_path, 'w') as f:
            for idx, r in enumerate(time_ranges):
                temp_audio = os.path.join(temp_dir, f"audio_{idx}_{uid}.m4a")
                temp_audios.append(temp_audio)
                
                start_t = r['start']
                dur = r['end'] - start_t
                
                if start_t < 10:
                    cmd = [
                        ffmpeg_path or 'ffmpeg', '-y',
                        '-i', original_path,
                        '-ss', str(start_t), '-t', str(dur),
                        '-vn'
                    ]
                else:
                    cmd = [
                        ffmpeg_path or 'ffmpeg', '-y',
                        '-ss', str(start_t - 10),
                        '-i', original_path,
                        '-ss', '10', '-t', str(dur),
                        '-vn'
                    ]
                
                if audio_enhance:
                    cmd += ['-acodec', 'aac', '-af', 'asetpts=PTS-STARTPTS,afftdn,loudnorm', temp_audio]
                else:
                    cmd += ['-acodec', 'aac', '-b:a', '192k', '-af', 'asetpts=PTS-STARTPTS', temp_audio]
                    
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                f.write(f"file '{temp_audio}'\n")
                
        concat_audio = os.path.join(temp_dir, f"concat_audio_{uid}.m4a")
        cmd_concat = [
            ffmpeg_path or 'ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', concat_list_path,
            '-acodec', 'copy', concat_audio
        ]
        subprocess.run(cmd_concat, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        final_video = os.path.join(temp_dir, f"final_{uid}.mp4")
        cmd_merge = [
            ffmpeg_path or 'ffmpeg', '-y', '-i', cropped_video_path, '-i', concat_audio,
            '-map', '0:v', '-map', '1:a?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
            final_video
        ]
        subprocess.run(cmd_merge, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        if os.path.exists(final_video) and os.path.getsize(final_video) > 0:
            os.replace(final_video, cropped_video_path)
            
    except Exception as e:
        sys.stderr.write(f"Error merging audio: {str(e)}\n")
    finally:
        if os.path.exists(concat_list_path):
            os.remove(concat_list_path)
        for ta in temp_audios:
            if os.path.exists(ta):
                os.remove(ta)
        if 'concat_audio' in locals() and os.path.exists(concat_audio):
            os.remove(concat_audio)

def resize_frame(frame, new_w, new_h):
    h, w = frame.shape[0], frame.shape[1]
    if h == new_h and w == new_w:
        return frame
    y_indices = (np.arange(new_h) * (h / new_h)).astype(int)
    x_indices = (np.arange(new_w) * (w / new_w)).astype(int)
    y_indices = np.clip(y_indices, 0, h - 1)
    x_indices = np.clip(x_indices, 0, w - 1)
    return frame[y_indices[:, None], x_indices, :]

def generate_wave_frame(w, h, frame_idx):
    img = np.zeros((h, w, 3), dtype=np.uint8)
    t = frame_idx * 0.05
    for c in range(3):
        phase = c * 2.09  # ~120 degrees phase shift
        y_vals = np.sin(np.arange(h) * 0.012 + t + phase) * 0.5 + 0.5
        x_vals = np.cos(np.arange(w) * 0.008 + t * 0.8 + phase) * 0.5 + 0.5
        outer = np.outer(y_vals, x_vals)
        img[..., c] = (outer * 140 + 30).astype(np.uint8)
    return img

def main():
    if len(sys.argv) < 2:
        print("Usage: python clipper.py <config_json_path>")
        sys.exit(1)
        
    config_path = sys.argv[1]
    with open(config_path, 'r') as f:
        cfg = json.load(f)
        
    ffmpeg_path = cfg.get('ffmpegPath')
    ffprobe_path = cfg.get('ffprobePath')
    input_path = cfg['inputPath']
    output_path = cfg['outputPath']
    crops = cfg.get('crops', [])
    aspect_ratio = cfg.get('aspectRatio', '9:16')
    
    # Smooth crops coordinates over time (1.6s moving average window)
    if crops:
        crops_sorted = sorted(crops, key=lambda x: x['time'])
        smoothed_crops = []
        for c in crops_sorted:
            if c.get('manual'):
                smoothed_crops.append(c)
                continue
            t_curr = c['time']
            sum_cx, sum_cy, count = 0.0, 0.0, 0
            for c_other in crops_sorted:
                if abs(c_other['time'] - t_curr) <= 0.8: # 0.8s radius (1.6s window)
                    sum_cx += c_other['cx']
                    sum_cy += c_other['cy']
                    count += 1
            smoothed_crops.append({
                'time': t_curr,
                'cx': sum_cx / count,
                'cy': sum_cy / count,
                'landmarks': c.get('landmarks'),
                'manual': c.get('manual')
            })
        crops = smoothed_crops
    time_ranges = cfg.get('timeRanges', [])
    heatmap_overlay = cfg.get('heatmapOverlay', False)
    dynamic_zoom = cfg.get('dynamicZoom', False)
    audio_enhance = cfg.get('audioEnhance', False)
    headline_text = cfg.get('headlineText', '')
    resolution = cfg.get('resolution')
    
    W, H, duration, fps = get_video_specs(ffprobe_path, input_path)
    if W == 0 or H == 0:
        sys.stderr.write("Invalid video file dimensions.\n")
        sys.exit(1)
        
    is_split = aspect_ratio == '9:16-split'
    
    # Map resolution string to target height
    resolution_height_map = {
        '1080p': 1080,
        '720p': 720,
        '480p': 480,
        '360p': 360
    }
    target_height = resolution_height_map.get(resolution)
    
    # 1. Compute output dimensions W_out, H_out
    if target_height:
        H_out = target_height
        if aspect_ratio == 'original':
            W_out = int(target_height * (W / H))
        elif aspect_ratio == '9:16' or is_split:
            W_out = int(target_height * (9/16))
        elif aspect_ratio == '1:1':
            W_out = target_height
        else:
            W_out = int(target_height * (W / H))
        W_out = (W_out // 2) * 2
        H_out = (H_out // 2) * 2
    else:
        if is_split:
            target_ratio_out = 9/16
            if W / H > target_ratio_out:
                H_out = H
                W_out = int(H * target_ratio_out)
            else:
                W_out = W
                H_out = int(W / target_ratio_out)
        else:
            if aspect_ratio == 'original':
                target_ratio = W / H
            else:
                target_ratio = 9/16 if aspect_ratio == '9:16' else 1.0
                
            if W / H > target_ratio:
                H_out = H
                W_out = int(H * target_ratio)
            else:
                W_out = W
                H_out = int(W / target_ratio)
        W_out = (W_out // 2) * 2
        H_out = (H_out // 2) * 2

    # 2. Compute native crop box size W_crop, H_crop
    if is_split:
        target_ratio = 9/8  # Speaker takes top half (aspect ratio 9/8 i.e. 720x640)
    else:
        if aspect_ratio == 'original':
            target_ratio = W / H
        else:
            target_ratio = 9/16 if aspect_ratio == '9:16' else 1.0
            
    if W / H > target_ratio:
        H_crop = H
        W_crop = int(H * target_ratio)
    else:
        W_crop = W
        H_crop = int(W / target_ratio)
    W_crop = (W_crop // 2) * 2
    H_crop = (H_crop // 2) * 2
        
    if not time_ranges:
        time_ranges = [{'start': 0.0, 'end': duration}]
        
    total_duration = sum(r['end'] - r['start'] for r in time_ranges)
    total_frames = int(total_duration * fps)
    processed_frames = 0
    
    cmd_out = [
        ffmpeg_path or 'ffmpeg', '-y',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W_out}x{H_out}', '-r', str(fps),
        '-i', '-',
    ]
    
    has_audio = False
    if len(time_ranges) == 1:
        r = time_ranges[0]
        start_t = r['start']
        dur = r['end'] - start_t
        
        if start_t < 10:
            cmd_out += [
                '-i', input_path,
                '-ss', str(start_t), '-t', str(dur),
            ]
        else:
            cmd_out += [
                '-ss', str(start_t - 10),
                '-i', input_path,
                '-ss', '10', '-t', str(dur),
            ]
            
        if audio_enhance:
            cmd_out += [
                '-map', '0:v', '-map', '1:a?',
                '-af', 'asetpts=PTS-STARTPTS,afftdn,loudnorm',
                '-shortest'
            ]
        else:
            cmd_out += [
                '-map', '0:v', '-map', '1:a?',
                '-c:a', 'aac', '-b:a', '192k',
                '-af', 'asetpts=PTS-STARTPTS',
                '-shortest'
            ]
        has_audio = True
    else:
        cmd_out += [
            '-map', '0:v'
        ]
        
    if headline_text:
        if check_drawtext_support(ffmpeg_path):
            escaped_text = headline_text.replace("'", "'\\\\''").replace(":", "\\:")
            font_path = "/System/Library/Fonts/Helvetica.ttc"
            cmd_out += [
                '-vf', f"drawtext=fontfile={font_path}:text='{escaped_text}':fontcolor=white:fontsize=28:box=1:boxcolor=black@0.6:boxborderw=15:x=(w-text_w)/2:y=40"
            ]
        else:
            sys.stderr.write("Warning: 'drawtext' filter not supported by ffmpeg. Skipping headline text overlay.\n")
        
    cmd_out += [
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-preset', 'fast', '-crf', '22',
        output_path
    ]
    
    proc_out = subprocess.Popen(cmd_out, stdin=subprocess.PIPE, stderr=sys.stderr)
    frame_size = W * H * 3
    heatmap_accum = np.zeros((H_crop, W_crop), dtype=np.float32)
    
    for r in time_ranges:
        start_t = r['start']
        end_t = r['end']
        
        dur = end_t - start_t
        if start_t < 10:
            cmd_in = [
                ffmpeg_path or 'ffmpeg',
                '-i', input_path,
                '-ss', str(start_t), '-t', str(dur),
                '-f', 'image2pipe', '-vcodec', 'rawvideo', '-pix_fmt', 'rgb24', '-'
            ]
        else:
            cmd_in = [
                ffmpeg_path or 'ffmpeg',
                '-ss', str(start_t - 10),
                '-i', input_path,
                '-ss', '10', '-t', str(dur),
                '-f', 'image2pipe', '-vcodec', 'rawvideo', '-pix_fmt', 'rgb24', '-'
            ]
        proc_in = subprocess.Popen(cmd_in, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        
        frame_idx = 0
        while True:
            raw_frame = proc_in.stdout.read(frame_size)
            if not raw_frame or len(raw_frame) != frame_size:
                break
                
            t = start_t + frame_idx / fps
            frame = np.frombuffer(raw_frame, dtype=np.uint8).reshape((H, W, 3))
            cx, cy, landmarks = get_crop_center(t, crops, W, H)
            
            # Dynamic zoom logic (jump cut every 6 seconds of speech)
            sf = 1.0
            if dynamic_zoom:
                cycle = int(t / 6.0) % 2
                if cycle == 1:
                    sf = 0.82  # Zoomed in by 18%
            
            cur_w = int(W_crop * sf)
            cur_h = int(H_crop * sf)
            cur_w = (cur_w // 2) * 2
            cur_h = (cur_h // 2) * 2
            
            x = cx - cur_w // 2
            y = cy - cur_h // 2
            x = max(0, min(W - cur_w, x))
            y = max(0, min(H - cur_h, y))
            x = (x // 2) * 2
            y = (y // 2) * 2
            
            cropped_frame = frame[y:y+cur_h, x:x+cur_w].copy()
            
            # Resize if zoomed
            if sf < 1.0:
                cropped_frame = resize_frame(cropped_frame, W_crop, H_crop)
            
            if heatmap_overlay:
                heatmap_accum *= 0.96
                if landmarks:
                    splat_points = []
                    splat_points.append((cx - x, cy - y, 0.4, int(min(W_crop, H_crop) * 0.15)))
                    for part, pt in landmarks.items():
                        pt_x = int(pt[0] * W) - x
                        pt_y = int(pt[1] * H) - y
                        intensity = 0.5 if 'eye' in part.lower() or 'mouth' in part.lower() else 0.3
                        sigma = int(min(W_crop, H_crop) * 0.05)
                        splat_points.append((pt_x, pt_y, intensity, sigma))
                        
                    for sx, sy, intensity, sigma in splat_points:
                        if 0 <= sx < W_crop and 0 <= sy < H_crop:
                            grid_y, grid_x = np.ogrid[-sy:H_crop-sy, -sx:W_crop-sx]
                            dist_sq = grid_x*grid_x + grid_y*grid_y
                            val = intensity * np.exp(-dist_sq / (2.0 * sigma * sigma))
                            heatmap_accum += val
                            
                heatmap_accum = np.clip(heatmap_accum, 0.0, 1.0)
                color_map = np.zeros((H_crop, W_crop, 3), dtype=np.uint8)
                color_map[..., 0] = (heatmap_accum * 255).astype(np.uint8)
                color_map[..., 1] = (np.clip(heatmap_accum - 0.4, 0.0, 0.6) * 1.66 * 255).astype(np.uint8)
                alpha = np.expand_dims(heatmap_accum * 0.6, axis=-1)
                cropped_frame = (alpha * color_map + (1.0 - alpha) * cropped_frame).astype(np.uint8)
                
            # If Split-Screen: combine speaker (top) and dynamic liquid wave background (bottom)
            if is_split:
                final_frame = np.zeros((H_out, W_out, 3), dtype=np.uint8)
                # Resize speaker frame to top half: W_out x H_out // 2
                speaker_h = H_out // 2
                top_part = resize_frame(cropped_frame, W_out, speaker_h)
                final_frame[0:speaker_h, 0:W_out] = top_part
                
                # Generate dynamic color wave background for bottom half
                bottom_part = generate_wave_frame(W_out, speaker_h, processed_frames)
                final_frame[speaker_h:H_out, 0:W_out] = bottom_part
            else:
                final_frame = resize_frame(cropped_frame, W_out, H_out)
                
            try:
                proc_out.stdin.write(final_frame.tobytes())
            except IOError:
                break
                
            frame_idx += 1
            processed_frames += 1
            
            if processed_frames % int(max(1, fps * 2)) == 0:
                pct = int((processed_frames / total_frames) * 90)
                print(f"PROGRESS:{pct}", flush=True)
                
        proc_in.terminate()
        proc_in.wait()
        
    proc_out.stdin.close()
    proc_out.wait()
    
    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        sys.stderr.write("FFmpeg failed: Output file is empty or missing.\n")
        sys.exit(1)
        
    if len(time_ranges) > 1:
        print("PROGRESS:92", flush=True)
        merge_multi_range_audio(ffmpeg_path, input_path, time_ranges, output_path, audio_enhance)
        
    print("PROGRESS:100", flush=True)
    os.remove(config_path)

if __name__ == '__main__':
    main()
