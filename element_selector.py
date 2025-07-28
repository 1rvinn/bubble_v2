import os
import re
import json
from typing import Tuple, Dict, Any, List, Optional
from dotenv import load_dotenv
from google import genai
from google.genai import types
from omni_api_hf_spaces import omni_api
from PIL import Image
import io
import base64

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

SYSTEM_INSTRUCTION = """
You are an expert UI agent. You are given:
- A screenshot of the user's screen with numbered annotations for each UI element.
- A list of UI elements (each with icon number, type, bbox, content, etc.).
- A user task (an atomic UI action to perform).

Your job is to:
1. Carefully analyze the screenshot and the UI element list in the context of the user task.
2. Select the single UI element (by icon number) that best matches the task and should be interacted with next.
3. Output ONLY a JSON object with the following keys:
   - 'icon': the icon number (integer) of the selected element
   - 'bbox': the bounding box (list of 4 floats) of the selected element
   - 'reason': a short explanation for your choice
   - 'action': a specific, atomic UI action description (e.g., 'Click the Export button')

If multiple elements could match, pick the best one. Do not output anything except the JSON object. Be precise and concise."
"""

generate_content_config = types.GenerateContentConfig(
    safety_settings=[
        types.SafetySetting(
            category="HARM_CATEGORY_HARASSMENT",
            threshold="BLOCK_ONLY_HIGH",  # Block few
        ),
        types.SafetySetting(
            category="HARM_CATEGORY_HATE_SPEECH",
            threshold="BLOCK_ONLY_HIGH",  # Block few
        ),
        types.SafetySetting(
            category="HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold="BLOCK_ONLY_HIGH",  # Block few
        ),
        types.SafetySetting(
            category="HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold="BLOCK_ONLY_HIGH",  # Block few
        ),
    ],
    response_mime_type="application/json",
    system_instruction=[
        types.Part.from_text(text=SYSTEM_INSTRUCTION),
    ],
)


def parse_element_string(element_string: str) -> List[Dict[str, Any]]:
    """
    Parses the newline-separated icon string from omni_api into a list of dicts.
    Each line is of the form: icon N: { ... }
    """
    elements = []
    for line in element_string.strip().split("\n"):
        match = re.match(r"icon (\d+): (\{.*\})", line)
        if match:
            icon_num = int(match.group(1))
            try:
                elem_dict = json.loads(match.group(2).replace("'", '"'))
            except json.JSONDecodeError:
                # fallback: try eval (less safe, but omni_api output is trusted)
                elem_dict = eval(match.group(2))
            elem_dict['icon'] = icon_num
            elements.append(elem_dict)
    return elements

def create_input(prompt: str, screenshot_base64: str):
    image = Image.open(io.BytesIO(base64.b64decode(screenshot_base64)))
    image.show()
    buffered = io.BytesIO()
    image.save(buffered, format="PNG")
    img_bytes = buffered.getvalue()

    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_bytes(
                    mime_type="image/png",
                    data=img_bytes,
                ),
                types.Part.from_text(text=prompt)
            ]
        )
    ]
    return contents

def select_element_with_llm(task: str, screenshot_base64: str, elements: List[Dict[str, Any]], max_retries: int = 2) -> Optional[Dict[str, Any]]:
    """
    Uses Gemini 2.5 Flash to select the icon and bbox for the given task from the element list.
    Now also returns a 'reason' for the choice.
    Retries if a valid selection is not made.
    """
    if not GEMINI_API_KEY:
        raise EnvironmentError("GEMINI_API_KEY environment variable not set.")
    client = genai.Client(
        api_key=GEMINI_API_KEY,
    )
    model = "gemini-2.5-flash"

    elements_json = json.dumps(elements, indent=2)
    user_prompt = (
        f"User task: {task}\n"
        f"UI elements:\n{elements_json}"
    )

    for attempt in range(max_retries):
        response = client.models.generate_content(
            model=model,
            contents=create_input(user_prompt, screenshot_base64),
            config=generate_content_config,
        )
        content = response.text.strip()
        # Try to extract the JSON object
        match = re.search(r'\{.*\}', content, re.DOTALL)
        if match:
            try:
                result = json.loads(match.group(0))
                if (
                    'icon' in result and
                    'bbox' in result and isinstance(result['bbox'], list) and len(result['bbox']) == 4 and
                    'reason' in result and isinstance(result['reason'], str) and
                    'action' in result and isinstance(result['action'], str)
                ):
                    return result
            except Exception:
                continue
    return None


def llm2_action_selector(screenshot_path: str, element_string: str, task: str) -> Tuple[int, List[float], str]:
    """
    Main entry point for LLM #2. Given a screenshot and a task, returns the icon number, bbox, and reason to interact with.

    Args:
        screenshot_path (str): Path to the screenshot image.
        element_string (str): Extracted element list.
        task (str): The atomic task to perform (from planner LLM).

    Returns:
        Tuple[int, List[float], str]: (icon number, bbox as list of 4 floats, reason)
    """
    # Call omni_api to get element string
    # _, element_string = omni_api(screenshot_path)
    elements = parse_element_string(element_string)
    if not elements:
        raise ValueError("No UI elements found in omni_api output.")
    result = select_element_with_llm(task, screenshot_path, elements)
    if not result:
        raise RuntimeError("LLM could not select a valid element after retries.")
    return result['icon'], result['bbox'], result['reason']