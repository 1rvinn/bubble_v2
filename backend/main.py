import sys
import json
import traceback
from capture_screenshot import capture
from element_selector import llm2_action_selector
from atomic_generator import generate_next_atomic_task
from omni_api_hf_spaces import omni_api
from PIL import Image
import os
import time

sys.stdout.reconfigure(encoding='utf-8')

def process_screenshot_request(screenshot_path, prompt):
    """
    Process a screenshot with the given prompt and return results
    """
    # Start timing for backend processing
    backend_start_time = time.time()
    print(f"[BACKEND TIMING] Backend processing started at: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    
    try:
        # Resize image if needed
        img_resize_start = time.time()
        img = Image.open(screenshot_path)
        width, height = img.size
        img = img.resize((640, int((640 / width) * height)))
        img.save(screenshot_path)
        img_resize_end = time.time()
        print(f"[BACKEND TIMING] Image resize completed in: {(img_resize_end - img_resize_start) * 1000:.2f}ms")
        
        # Generate atomic task
        task_gen_start = time.time()
        print(f"[BACKEND TIMING] Starting atomic task generation at: {time.strftime('%Y-%m-%d %H:%M:%S')}")
        task = generate_next_atomic_task(prompt, screenshot_path, [])
        task_gen_end = time.time()
        print(f"[BACKEND TIMING] Atomic task generation completed in: {(task_gen_end - task_gen_start) * 1000:.2f}ms")
        
        if task is None:
            backend_end_time = time.time()
            print(f"[BACKEND TIMING] Task completed, total backend time: {(backend_end_time - backend_start_time) * 1000:.2f}ms")
            return {
                "status": "completed",
                "message": "Task completed",
                "highlighting_boxes": []
            }
        
        # Get screenshot data and element string
        screenshot_b64_start = time.time()
        import base64
        with open(screenshot_path, "rb") as image_file:
            screenshot_b64 = base64.b64encode(image_file.read()).decode("utf-8")
        screenshot_b64_end = time.time()
        print(f"[BACKEND TIMING] Base64 encoding completed in: {(screenshot_b64_end - screenshot_b64_start) * 1000:.2f}ms")
        
        # Call Omni API
        omni_start = time.time()
        print(f"[BACKEND TIMING] Starting Omni API call at: {time.strftime('%Y-%m-%d %H:%M:%S')}")
        screenshot_b64, element_string = omni_api(screenshot_b64)
        omni_end = time.time()
        print(f"[BACKEND TIMING] Omni API processing completed in: {(omni_end - omni_start) * 1000:.2f}ms")
        
        # Select element
        element_select_start = time.time()
        print(f"[BACKEND TIMING] Starting element selection at: {time.strftime('%Y-%m-%d %H:%M:%S')}")
        icon, bbox, reason = llm2_action_selector(screenshot_b64, element_string, task['action'])
        element_select_end = time.time()
        print(f"[BACKEND TIMING] Element selection completed in: {(element_select_end - element_select_start) * 1000:.2f}ms")
        
        # Format bounding box for frontend
        highlighting_boxes = [{
            "x": bbox[0],
            "y": bbox[1], 
            "width": bbox[2] - bbox[0],
            "height": bbox[3] - bbox[1],
            "icon": icon,
            "reason": reason,
            "action": task['action']
        }]
        
        backend_end_time = time.time()
        total_backend_time = (backend_end_time - backend_start_time) * 1000
        print(f"[BACKEND TIMING] Backend processing completed at: {time.strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"[BACKEND TIMING] TOTAL BACKEND TIME: {total_backend_time:.2f}ms")
        
        return {
            "status": "success",
            "highlighting_boxes": highlighting_boxes,
            "task": task,
            "icon": icon,
            "bbox": bbox,
            "reason": reason
        }
        
    except Exception as e:
        backend_end_time = time.time()
        total_backend_time = (backend_end_time - backend_start_time) * 1000
        print(f"[BACKEND TIMING] Backend processing failed after: {total_backend_time:.2f}ms")
        error_msg = f"Error processing screenshot: {str(e)}"
        print(error_msg, file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return {
            "status": "error",
            "message": error_msg,
            "highlighting_boxes": []
        }

def main():
    """
    Main function to handle IPC communication
    """
    try:
        for line in sys.stdin:
            try:
                # Parse JSON input from Electron
                data = json.loads(line.strip())
                
                if data.get('action') == 'process_screenshot':
                    screenshot_path = data.get('screenshot_path')
                    prompt = data.get('prompt', '')
                    
                    if not screenshot_path or not os.path.exists(screenshot_path):
                        result = {
                            "status": "error",
                            "message": f"Screenshot file not found: {screenshot_path}",
                            "highlighting_boxes": []
                        }
                    else:
                        result = process_screenshot_request(screenshot_path, prompt)
                    
                    # Send result back to Electron
                    print(json.dumps(result))
                    sys.stdout.flush()
                    
                else:
                    result = {
                        "status": "error", 
                        "message": f"Unknown action: {data.get('action')}",
                        "highlighting_boxes": []
                    }
                    print(json.dumps(result))
                    sys.stdout.flush()
                    
            except json.JSONDecodeError as e:
                error_result = {
                    "status": "error",
                    "message": f"Invalid JSON: {str(e)}",
                    "highlighting_boxes": []
                }
                print(json.dumps(error_result))
                sys.stdout.flush()
                
    except KeyboardInterrupt:
        print(json.dumps({"status": "shutdown", "message": "Backend shutting down"}))
        sys.stdout.flush()
    except Exception as e:
        error_result = {
            "status": "error",
            "message": f"Backend error: {str(e)}",
            "highlighting_boxes": []
        }
        print(json.dumps(error_result))
        sys.stdout.flush()

if __name__ == "__main__":
    main()
    
