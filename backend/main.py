import sys
import json
import traceback
from capture_screenshot import capture
from element_selector import llm2_action_selector
from atomic_generator import generate_next_atomic_task
from omni_api_hf_spaces import omni_api
from PIL import Image
import os

def process_screenshot_request(screenshot_path, prompt):
    """
    Process a screenshot with the given prompt and return results
    """
    try:
        # Resize image if needed
        img = Image.open(screenshot_path)
        width, height = img.size
        img = img.resize((640, int((640 / width) * height)))
        img.save(screenshot_path)
        
        # Generate atomic task
        task = generate_next_atomic_task(prompt, screenshot_path, [])
        
        if task is None:
            return {
                "status": "completed",
                "message": "Task completed",
                "highlighting_boxes": []
            }
        
        # Get screenshot data and element string
        screenshot_b64, element_string = omni_api(screenshot_path)
        
        # Select element
        icon, bbox, reason = llm2_action_selector(screenshot_b64, element_string, task['action'])
        
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
        
        return {
            "status": "success",
            "highlighting_boxes": highlighting_boxes,
            "task": task,
            "icon": icon,
            "bbox": bbox,
            "reason": reason
        }
        
    except Exception as e:
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
    
