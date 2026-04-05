"""
Step 3: Generate a thumbnail image using a local diffusion model.
"""

import gc
import os
import re
import subprocess
import tempfile

import torch
from PIL import Image

import config
from observability import get_logger

logger = get_logger(__name__)

_cached_pipe = None
_cached_pipeline_class = None
_cached_model_id = None
_cached_device = None
_cached_dtype = None

DEFAULT_FALLBACK_URL = (
    "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&q=80"
)


def _normalize_model_id(model_id: str | None = None) -> str:
    return str(model_id or config.IMAGE_MODEL_ID or "").strip()


def _image_backend() -> str:
    return str(getattr(config, "IMAGE_BACKEND", "diffusers") or "diffusers").strip().lower()


def _model_cache_dir(model_id: str | None = None) -> str:
    normalized = _normalize_model_id(model_id)
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "--", normalized).strip("-") or "default"
    return os.path.join(config.MODEL_DIR, "image_models", safe_name)


def _model_generation_defaults(model_id: str | None = None) -> dict[str, object]:
    model_lower = _normalize_model_id(model_id).lower()
    if "sd-turbo" in model_lower or "sdxl-turbo" in model_lower:
        return {
            "preferred_width": 384,
            "preferred_height": 384,
            "num_inference_steps": 1,
            "guidance_scale": 0.0,
            "supports_negative_prompt": False,
        }
    return {
        "preferred_width": None,
        "preferred_height": None,
        "num_inference_steps": None,
        "guidance_scale": None,
        "supports_negative_prompt": True,
    }


def _pipeline_pretrained_kwargs(model_id: str, dtype) -> dict[str, object]:
    model_lower = _normalize_model_id(model_id).lower()
    kwargs: dict[str, object] = {
        "torch_dtype": dtype,
        "cache_dir": _model_cache_dir(model_id),
        # Avoid meta-tensor loading paths that can break on MPS/CPU.
        "low_cpu_mem_usage": False,
        "device_map": None,
    }
    if config.HF_TOKEN:
        kwargs["token"] = config.HF_TOKEN
    if ("sd-turbo" in model_lower or "sdxl-turbo" in model_lower) and dtype == torch.float16:
        kwargs["variant"] = "fp16"
    return kwargs


def _load_pretrained_pipeline(PipelineClass, model_id: str, kwargs: dict[str, object]):
    model_lower = _normalize_model_id(model_id).lower()
    try:
        return PipelineClass.from_pretrained(model_id, **kwargs)
    except ValueError as e:
        # Some Flux checkpoints omit optional components; retry with explicit None for FluxPipeline.
        if PipelineClass.__name__ != "FluxPipeline":
            raise
        msg = str(e)
        missing = ("feature_extractor", "image_encoder", "text_encoder_2", "tokenizer_2")
        if not any(part in msg for part in missing):
            raise
        return PipelineClass.from_pretrained(
            model_id,
            text_encoder_2=None,
            tokenizer_2=None,
            image_encoder=None,
            feature_extractor=None,
            **kwargs,
        )
    except OSError:
        if "variant" not in kwargs or not ("sd-turbo" in model_lower or "sdxl-turbo" in model_lower):
            raise
        fallback_kwargs = dict(kwargs)
        fallback_kwargs.pop("variant", None)
        return PipelineClass.from_pretrained(model_id, **fallback_kwargs)


def _get_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _get_dtype(device: str):
    if device == "mps":
        return torch.float16
    return torch.float32


def _load_pipe():
    global _cached_pipe, _cached_pipeline_class, _cached_model_id, _cached_device, _cached_dtype

    model_id = _normalize_model_id()
    device = _get_device()
    dtype = _get_dtype(device)
    PipelineClass = _resolve_pipeline_class(model_id)
    cache_enabled = bool(config.IMAGE_PIPELINE_CACHE_ENABLED)

    if not cache_enabled and _cached_pipe is not None:
        _release_cached_pipe()

    if (
        not cache_enabled
        or _cached_pipe is None
        or _cached_pipeline_class != PipelineClass
        or _cached_model_id != model_id
        or _cached_device != device
        or _cached_dtype != dtype
    ):
        kwargs = _pipeline_pretrained_kwargs(model_id, dtype)
        pipe = _load_pretrained_pipeline(PipelineClass, model_id, kwargs)
        pipe.to(device)
        pipe.set_progress_bar_config(disable=True)

        # Memory optimizations
        if hasattr(pipe, "enable_attention_slicing"):
            pipe.enable_attention_slicing()
        if hasattr(pipe, "enable_vae_slicing"):
            pipe.enable_vae_slicing()
        if hasattr(pipe, "enable_vae_tiling"):
            pipe.enable_vae_tiling()

        if cache_enabled:
            _cached_pipe = pipe
            _cached_pipeline_class = PipelineClass
            _cached_model_id = model_id
            _cached_device = device
            _cached_dtype = dtype
        else:
            _clear_cached_pipe_state()
            return pipe

    return _cached_pipe


def _clear_cached_pipe_state() -> None:
    global _cached_pipe, _cached_pipeline_class, _cached_model_id, _cached_device, _cached_dtype
    _cached_pipe = None
    _cached_pipeline_class = None
    _cached_model_id = None
    _cached_device = None
    _cached_dtype = None


def _release_cached_pipe() -> None:
    pipe = _cached_pipe
    _clear_cached_pipe_state()
    if pipe is not None:
        del pipe
    _empty_runtime_cache()


def _empty_runtime_cache() -> None:
    try:
        gc.collect()
    except Exception:
        pass

    cuda = getattr(torch, "cuda", None)
    if cuda is not None and hasattr(cuda, "empty_cache"):
        try:
            cuda.empty_cache()
        except Exception:
            pass

    mps = getattr(torch, "mps", None)
    if mps is not None and hasattr(mps, "empty_cache"):
        try:
            mps.empty_cache()
        except Exception:
            pass


def _resolve_pipeline_class(model_id: str):
    model_lower = (model_id or "").lower()
    if "flux.2" in model_lower:
        try:
            from diffusers import Flux2Pipeline
        except Exception as e:
            raise RuntimeError(
                "Flux2 pipelines are not available. Install diffusers from git main."
            ) from e
        # Flux2KleinPipeline may not exist in some diffusers builds.
        if "klein" in model_lower:
            try:
                from diffusers import Flux2KleinPipeline
                return Flux2KleinPipeline
            except Exception:
                return Flux2Pipeline
        return Flux2Pipeline

    if "flux" in model_lower:
        from diffusers import FluxPipeline
        return FluxPipeline

    from diffusers import AutoPipelineForText2Image
    return AutoPipelineForText2Image


def _generate_image_coreml(
    prompt: str,
    negative_prompt: str | None,
    *,
    num_inference_steps: int,
    guidance_scale: float,
) -> str:
    python_exec = str(getattr(config, "IMAGE_COREML_PYTHON", "") or "").strip()
    resources_dir = str(getattr(config, "IMAGE_COREML_RESOURCES_DIR", "") or "").strip()
    model_version = str(
        getattr(config, "IMAGE_COREML_MODEL_VERSION", "") or "stabilityai/stable-diffusion-xl-base-1.0"
    ).strip()
    compute_unit = str(getattr(config, "IMAGE_COREML_COMPUTE_UNIT", "") or "CPU_AND_GPU").strip()
    timeout_seconds = max(30, int(getattr(config, "IMAGE_COREML_TIMEOUT_SECONDS", 900) or 900))
    seed = int(getattr(config, "IMAGE_SEED", 93) or 93)

    if not python_exec or not os.path.isfile(python_exec):
        raise FileNotFoundError(
            f"IMAGE_COREML_PYTHON is not configured to a valid executable: {python_exec or '<empty>'}"
        )
    if not resources_dir or not os.path.isdir(resources_dir):
        raise FileNotFoundError(
            f"IMAGE_COREML_RESOURCES_DIR is not configured to a valid directory: {resources_dir or '<empty>'}"
        )

    coreml_repo_dir = os.path.abspath(os.path.join(os.path.dirname(python_exec), "..", ".."))
    output_dir = tempfile.mkdtemp(prefix="calmdemy_coreml_")
    cmd = [
        python_exec,
        "-m",
        "python_coreml_stable_diffusion.pipeline",
        "--prompt",
        prompt,
        "-i",
        resources_dir,
        "-o",
        output_dir,
        "--compute-unit",
        compute_unit,
        "--model-version",
        model_version,
        "--seed",
        str(seed),
        "--num-inference-steps",
        str(num_inference_steps),
        "--guidance-scale",
        str(guidance_scale),
    ]
    if negative_prompt:
        cmd.extend(["--negative-prompt", negative_prompt])

    result = subprocess.run(
        cmd,
        cwd=coreml_repo_dir,
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        check=False,
        env={
            **os.environ,
            "PYTHONUNBUFFERED": "1",
        },
    )
    if result.returncode != 0:
        details = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(
            f"Core ML image generation failed with exit code {result.returncode}: {details}"
        )

    for root, _dirs, files in os.walk(output_dir):
        for name in files:
            if name.lower().endswith(".png"):
                return os.path.join(root, name)

    raise RuntimeError("Core ML image generation completed without producing a PNG output")


def _generate_image_diffusers(
    prompt: str,
    negative_prompt: str | None,
    *,
    width: int,
    height: int,
    num_inference_steps: int,
    guidance_scale: float,
) -> str:
    pipe = _load_pipe()
    cache_enabled = bool(config.IMAGE_PIPELINE_CACHE_ENABLED)
    result = None
    image = None

    kwargs = {
        "prompt": prompt,
        "width": width,
        "height": height,
        "num_inference_steps": num_inference_steps,
        "guidance_scale": guidance_scale,
    }
    if negative_prompt and bool(_model_generation_defaults().get("supports_negative_prompt", True)):
        kwargs["negative_prompt"] = negative_prompt

    try:
        result = pipe(**kwargs)
        image = result.images[0]

        if not isinstance(image, Image.Image):
            raise RuntimeError("Image generation did not return a PIL image")

        tmp_dir = tempfile.mkdtemp(prefix="calmdemy_img_")
        output_path = os.path.join(tmp_dir, "thumbnail.jpg")
        image.save(output_path, format="JPEG", quality=85)
        return output_path
    finally:
        if result is not None:
            del result
        if image is not None:
            del image
        if not cache_enabled:
            del pipe
            _empty_runtime_cache()


def generate_image(
    prompt: str,
    negative_prompt: str | None = None,
    width: int | None = None,
    height: int | None = None,
    num_inference_steps: int | None = None,
    guidance_scale: float | None = None,
) -> str:
    """Generate an image from a prompt and return local file path."""
    model_defaults = _model_generation_defaults()

    width = width or int(model_defaults.get("preferred_width") or config.IMAGE_WIDTH)
    height = height or int(model_defaults.get("preferred_height") or config.IMAGE_HEIGHT)
    num_inference_steps = int(
        num_inference_steps
        or model_defaults.get("num_inference_steps")
        or config.IMAGE_STEPS
    )
    guidance_scale = (
        guidance_scale
        if guidance_scale is not None
        else model_defaults.get("guidance_scale")
        if model_defaults.get("guidance_scale") is not None
        else config.IMAGE_GUIDANCE
    )

    if _image_backend() == "coreml":
        return _generate_image_coreml(
            prompt,
            negative_prompt,
            num_inference_steps=num_inference_steps,
            guidance_scale=float(guidance_scale),
        )

    return _generate_image_diffusers(
        prompt,
        negative_prompt,
        width=width,
        height=height,
        num_inference_steps=num_inference_steps,
        guidance_scale=float(guidance_scale),
    )


def _clean_prompt_fragment(value: object) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text.rstrip(".,;: ")


def _collect_course_plan_highlights(plan: dict | None) -> list[str]:
    if not isinstance(plan, dict):
        return []

    highlights: list[str] = []
    intro = plan.get("intro") or {}
    intro_outline = _clean_prompt_fragment(intro.get("outline")) if isinstance(intro, dict) else ""
    if intro_outline:
        highlights.append(f"Intro outline: {intro_outline}")

    modules = list(plan.get("modules") or [])
    for module in modules[:2]:
        if not isinstance(module, dict):
            continue
        module_title = _clean_prompt_fragment(module.get("moduleTitle"))
        objective = _clean_prompt_fragment(module.get("objective"))
        lesson_summary = _clean_prompt_fragment(module.get("lessonSummary"))
        practice_type = _clean_prompt_fragment(module.get("practiceType"))
        if module_title:
            highlights.append(f"Module theme: {module_title}")
        if objective:
            highlights.append(f"Module objective: {objective}")
        if lesson_summary:
            highlights.append(f"Lesson summary: {lesson_summary}")
        if practice_type:
            highlights.append(f"Practice type: {practice_type}")
        if len(highlights) >= 6:
            break

    return highlights[:6]


def _fallback_image_prompt(job_data: dict, title: str, topic: str, content_type: str, plan: dict | None = None) -> str:
    params = job_data.get("params", {}) or {}
    goal = _clean_prompt_fragment((plan or {}).get("courseGoal"))
    subject = _clean_prompt_fragment(params.get("subjectLabel"))
    tone = _clean_prompt_fragment(params.get("tone"))
    module_title = ""
    if isinstance(plan, dict):
        first_module = next(
            (module for module in list(plan.get("modules") or []) if isinstance(module, dict)),
            None,
        )
        if first_module:
            module_title = _clean_prompt_fragment(first_module.get("moduleTitle"))

    anchor = module_title or goal or _clean_prompt_fragment(topic) or _clean_prompt_fragment(title) or "the course theme"
    descriptor_parts = [part for part in [subject, tone] if part]
    descriptor = " ".join(descriptor_parts).strip()
    if descriptor:
        descriptor = f"{descriptor} "

    return (
        f"Distinct {descriptor}app thumbnail for {title}: a serene, premium visual centered on {anchor}, "
        f"inspired by {goal or _clean_prompt_fragment(topic) or content_type}, soft cinematic light, "
        "intentional color palette, clean composition, no text, no logos, no people."
    )


def build_image_prompt(
    job_data: dict,
    title: str,
    topic: str,
    content_type: str,
    plan: dict | None = None,
    *,
    ignore_saved_prompt: bool = False,
) -> str:
    """Generate or return an image prompt for a job."""
    image_prompt = (job_data.get("imagePrompt") or "").strip()
    if image_prompt and not ignore_saved_prompt:
        return image_prompt

    from .llm_generator import _get_llm_adapter

    params = job_data.get("params", {}) or {}
    base_context = [
        f"Content type: {content_type}",
        f"Title: {title}",
        f"Topic: {topic}",
    ]
    if plan:
        goal = plan.get("courseGoal") or ""
        subject = params.get("subjectLabel", "")
        if goal:
            base_context.append(f"Course goal: {goal}")
        if subject:
            base_context.append(f"Subject: {subject}")
        base_context.extend(_collect_course_plan_highlights(plan))
    audience = _clean_prompt_fragment(params.get("targetAudience"))
    tone = _clean_prompt_fragment(params.get("tone"))
    if audience:
        base_context.append(f"Audience: {audience}")
    if tone:
        base_context.append(f"Tone: {tone}")

    prompt = (
        "You write distinct, premium image prompts for app thumbnails. "
        "Output a single sentence only. "
        "Use the provided context to generate an appropriate visual concept that fits the course. "
        "Use one clear visual metaphor or scene. "
        "No text, no logos, no people.\n\n"
        + "\n".join(base_context)
    )

    try:
        adapter = _get_llm_adapter(job_data)
        raw = adapter.generate(prompt, max_tokens=120).strip()
        raw = raw.split("\n")[0].strip().strip('"\'')
        if raw:
            return raw
    except Exception as e:
        logger.warning("Prompt generation failed", extra={"error": str(e)})

    return _fallback_image_prompt(job_data, title, topic, content_type, plan=plan)
