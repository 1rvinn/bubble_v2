import os
import base64
from typing import List, Dict
from dotenv import load_dotenv
from google import genai
from google.genai import types
from PIL import Image
import io
import sys
import traceback

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
client = genai.Client(
    api_key=GEMINI_API_KEY,
)

model = "gemini-2.5-flash"

SYSTEM_INSTRUCTION = (
    """You are a helpful assistant that receives a user's goal and a screenshot of their desktop. "
    Your job is to break down the user's goal into an ordered list of broad, high-level steps. "
    Do NOT describe precise button presses or specific UI actions. However, do ensure that the instructions arent vague, they should be specific intents."
    Each step should describe a general action or intent (e.g., 'Export the document', 'Save your work', 'Open the settings menu'), not specific UI interactions. "
    Output the result as a JSON array of objects, each with 'step' (int) and 'action' (str)."""
)

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


def create_input(prompt: str, image_path: str):
    image = Image.open(image_path)
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
    

def planner_llm(prompt: str, screenshot_path: str) -> List[Dict[str, str]]:
    """
    Calls Gemini 2.5 Flash (via google-generativeai SDK) to generate an ordered list of atomic UI tasks.

    Args:
        prompt (str): User's natural language query.
        screenshot_path (str): Path to the screenshot image file.

    Returns:
        List[Dict[str, str]]: List of {step, action} dicts.
    """
    if not GEMINI_API_KEY:
        raise EnvironmentError("GEMINI_API_KEY environment variable not set.")
    if not os.path.isfile(screenshot_path):
        raise FileNotFoundError(f"Screenshot file not found: {screenshot_path}")

    user_prompt = (
        f"""User goal: {prompt}\n
        Here is the screenshot of the desktop."""
    )
    try:
        response = client.models.generate_content(
          model=model,
          contents=create_input(user_prompt, screenshot_path),
          config=generate_content_config,
      )
        content = response.text.strip()
        import re, json as pyjson
        match = re.search(r'\[.*\]', content, re.DOTALL)
        if not match:
            raise ValueError("No JSON array found in Gemini response.")
        tasks = pyjson.loads(match.group(0))
        # Validate format
        for task in tasks:
            if not ("step" in task and "action" in task):
                raise ValueError("Each task must have 'step' and 'action'.")
        return tasks
    except Exception as e:
        raise RuntimeError(f"Failed to parse Gemini response: {e}\nRaw response: {getattr(response, 'text', str(response))}")
