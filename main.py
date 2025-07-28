from capture_screenshot import capture
from element_selector import llm2_action_selector
from atomic_generator import generate_next_atomic_task
from omni_api_hf_spaces import omni_api
from PIL import Image
from pynput import keyboard
import threading
import time

if __name__=="__main__":
    # prompt=input('how can i help you?: ')
    prompt=' how to change the course number from CH3030 to CH4000 everywhere ?'
    # screenshot_path=capture()
    screenshot_path='image2.png' # the first screenshot to send to the planner
    img = Image.open(screenshot_path)
    img = img.resize((1280, 720))  # or another reasonable size
    img.save(screenshot_path)

    hotkey_pressed_event = threading.Event()

    def on_activate():
        print('hotkey pressed')
        hotkey_pressed_event.set()

    # Define the hotkey: Ctrl+Shift+0 (unlikely to conflict)
    hotkey = keyboard.HotKey(
        keyboard.HotKey.parse('<ctrl>+<shift>+0'),
        on_activate
    )

    def for_listener():
        with keyboard.Listener(
            on_press=lambda key: hotkey.press(key),
            on_release=lambda key: hotkey.release(key)
        ) as listener:
            listener.join()

    listener_thread = threading.Thread(target=for_listener, daemon=True)
    listener_thread.start()
    flag=True
    history=[]
    while flag:
        print(f"\nReady, press Ctrl+Shift+0 to continue...")
        hotkey_pressed_event.clear()
        hotkey_pressed_event.wait()
        t1=time.time()
        screenshot_path=capture() # the second screenshot of current screen scenario for atomic task gen
        t2=time.time()
        print(f'screenshot captured. time taken: {t2-t1}')
        task=generate_next_atomic_task(prompt, screenshot_path, history)
        print(f"history: \n {history}")
        print(f"task: \n {task}")
        if task==None:
            flag=False
            print('Task completed!')
        else:
            history.append(task)
            screenshot_b64, element_string = omni_api(screenshot_path)
            try:
                icon, bbox, reason = llm2_action_selector(screenshot_b64, element_string, task['action'])
                print(f"Step: {task['step']}")
                print(f"Selected icon: {icon}")
                print(f"Bounding box: {bbox}")
                print(f"Reason: {reason}")
            except Exception as e:
                print(f"Error: {e}")

    # for step in plan:
    #     print(f"\nReady for next step: {step['action']}. Press Ctrl+Shift+0 to continue...")
    #     hotkey_pressed_event.clear()
    #     hotkey_pressed_event.wait()
    #     # need to add a cue here
    #     t1=time.time()
    #     screenshot_path=capture() # the second screenshot of current screen scenario for atomic task gen
    #     t2=time.time()
    #     print(f'screenshot captured. time taken: {t2-t1}')
    #     tasks=generate_atomic_tasks(broad_step=step['action'], screenshot_path=screenshot_path)
    #     print('tasks:\n',tasks)
    #     # print(screenshot_b64,element_string)
    #     for task in tasks:
    #         # screenshot_path=capture()
    #         screenshot_b64, element_string = omni_api(screenshot_path)
    #         try:
    #             icon, bbox, reason = llm2_action_selector(screenshot_b64, element_string, task['action'])
    #             print(f"Step: {task['step']}")
    #             print(f"Selected icon: {icon}")
    #             print(f"Bounding box: {bbox}")
    #             print(f"Reason: {reason}")
    #         except Exception as e:
    #             print(f"Error: {e}")

    # No need to stop the listener explicitly as the thread is daemonized
    # tasks is a list of dicts
    
