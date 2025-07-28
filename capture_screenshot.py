import pyautogui
import tempfile
import os

def capture(screenshot_path: str = None) -> str:
    # if screenshot_path:
    #     # Already provided by Electron, just return it
    #     return screenshot_path
    temp_dir = tempfile.gettempdir()
    screenshot_path = os.path.join(temp_dir, "screenshot.png")
    screenshot = pyautogui.screenshot()
    screenshot.save(screenshot_path)
    return screenshot_path