import os
import json
import re
from typing import List, Dict, Optional
from dotenv import load_dotenv
from google import genai
from google.genai import types
from PIL import Image
import io
import time

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise EnvironmentError("GEMINI_API_KEY environment variable not set.")

SYSTEM_INSTRUCTION = (
    "You are a helpful UI assistant that receives a high-level user goal, a screenshot of the user's desktop, and a list of already completed atomic UI actions, each with a status of 'success' or 'failure'. "
    "On the basis of the current state, previous actions, their status, and user intent, your job is to output ONLY the next atomic UI action as a JSON object with 'step' (int) and 'action' (str). "
    "If the previous step in the history has status 'success', move on to the next step. "
    "If the previous step has status 'failure', it means that was not the right step, so retry or suggest a different action for the same step. "
    "Only if the user task is totally complete, output {\"done\": true}. Otherwise, output the next atomic UI action as {\"step\": <int>, \"action\": <str>} "
    "IMPORTANT: Only interact with UI elements that are inside open application windows. Do NOT interact with elements in the taskbar, system tray, or operating system chrome."
)

generate_content_config = types.GenerateContentConfig(
    safety_settings=[
        types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_ONLY_HIGH"),
        types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_ONLY_HIGH"),
        types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_ONLY_HIGH"),
        types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_ONLY_HIGH"),
    ],
    response_mime_type="application/json",
    system_instruction=[types.Part.from_text(text=SYSTEM_INSTRUCTION)],
)

def create_input(user_prompt: str, screenshot_path: str, history: List[Dict]) -> list:
    image = Image.open(screenshot_path)
    buffered = io.BytesIO()
    image.save(buffered, format="PNG")
    img_bytes = buffered.getvalue()

    if history:
        history_str = json.dumps(history, indent=2)
        history_section = f"\nCompleted atomic actions so far (in order):\n{history_str}"
    else:
        history_section = "\nNo atomic actions have been completed yet."

    next_action_instruction = (
        "Given the high-level user goal, the current screenshot, and the list of already completed atomic UI actions, "
        "output ONLY a JSON object. If the task is already complete, output {\"done\": true}. "
        "Otherwise, output the next atomic UI action as {\"step\": <int>, \"action\": <str>}"
    )

    user_full_prompt = (
        f"User goal: {user_prompt}\n"
        f"{history_section}\n"
        f"{next_action_instruction}"
    )

    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_bytes(mime_type="image/png", data=img_bytes),
                types.Part.from_text(text=user_full_prompt)
            ]
        )
    ]
    return contents

def generate_next_atomic_task(user_prompt: str, screenshot_path: str, history: List[Dict]) -> Optional[Dict[str, str]]:
    """
    Uses Gemini 2.5 Flash to generate the next atomic UI action given the user goal, current screenshot, and history of completed tasks.
    Returns the next atomic task as a dict, or None if the task is complete.
    """
    if not os.path.isfile(screenshot_path):
        raise FileNotFoundError(f"Screenshot file not found: {screenshot_path}")

    client = genai.Client(api_key=GEMINI_API_KEY)
    model = "gemini-2.5-flash"

    try:
        gemini_start = time.time()
        print(f"[GEMINI TIMING] Starting Gemini API call at: {time.strftime('%Y-%m-%d %H:%M:%S')}")
        
        response = client.models.generate_content(
            model=model,
            contents=create_input(user_prompt, screenshot_path, history),
            config=generate_content_config,
        )
        
        gemini_end = time.time()
        gemini_time = (gemini_end - gemini_start) * 1000
        print(f"[GEMINI TIMING] Gemini API call completed in: {gemini_time:.2f}ms")
        
        content = response.text.strip()
        try:
            task = json.loads(content)
        except Exception:
            # Try to extract JSON object if LLM adds extra text
            match = re.search(r'\{.*\}', content, re.DOTALL)
            if not match:
                raise ValueError("No JSON object found in Gemini response.")
            task = json.loads(match.group(0))
        if task.get("done") is True:
            return None
        if "step" in task and "action" in task:
            return task
        raise ValueError("Unexpected response format: " + str(task))
    except Exception as e:
        raise RuntimeError(f"Failed to parse Gemini response: {e}\nRaw response: {getattr(response, 'text', str(response))}")
