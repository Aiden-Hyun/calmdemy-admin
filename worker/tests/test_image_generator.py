from __future__ import annotations

import os
import shutil
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)

from factory_v2.shared import image_generator


class _FakePipe:
    def __init__(self) -> None:
        self.calls = []

    def to(self, _device: str) -> "_FakePipe":
        return self

    def set_progress_bar_config(self, **_kwargs) -> None:
        return None

    def enable_attention_slicing(self) -> None:
        return None

    def enable_vae_slicing(self) -> None:
        return None

    def enable_vae_tiling(self) -> None:
        return None

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(images=[Image.new("RGB", (8, 8), color="white")])


class _FakePipelineClass:
    created_pipes: list[_FakePipe] = []

    @classmethod
    def from_pretrained(cls, *_args, **_kwargs) -> _FakePipe:
        pipe = _FakePipe()
        cls.created_pipes.append(pipe)
        return pipe


class ImageGeneratorTests(unittest.TestCase):
    def setUp(self) -> None:
        _FakePipelineClass.created_pipes = []
        image_generator._release_cached_pipe()

    def tearDown(self) -> None:
        image_generator._release_cached_pipe()

    def test_generate_image_does_not_reuse_pipeline_when_cache_disabled(self) -> None:
        output_paths: list[str] = []

        with (
            patch.object(image_generator.config, "IMAGE_BACKEND", "diffusers"),
            patch.object(image_generator.config, "IMAGE_PIPELINE_CACHE_ENABLED", False),
            patch.object(image_generator.config, "IMAGE_MODEL_ID", "fake/flux"),
            patch.object(image_generator, "_resolve_pipeline_class", return_value=_FakePipelineClass),
            patch.object(image_generator, "_empty_runtime_cache") as empty_runtime_cache,
        ):
            first_path = image_generator.generate_image("calm lake at sunrise", width=8, height=8)
            second_path = image_generator.generate_image("forest path", width=8, height=8)
            output_paths.extend([first_path, second_path])

        self.assertEqual(len(_FakePipelineClass.created_pipes), 2)
        self.assertIsNone(image_generator._cached_pipe)
        self.assertEqual(empty_runtime_cache.call_count, 2)

        for output_path in output_paths:
            self.assertTrue(os.path.exists(output_path))
            shutil.rmtree(os.path.dirname(output_path), ignore_errors=True)

    def test_generate_image_reuses_pipeline_when_cache_enabled(self) -> None:
        output_paths: list[str] = []

        with (
            patch.object(image_generator.config, "IMAGE_BACKEND", "diffusers"),
            patch.object(image_generator.config, "IMAGE_PIPELINE_CACHE_ENABLED", True),
            patch.object(image_generator.config, "IMAGE_MODEL_ID", "fake/flux"),
            patch.object(image_generator, "_resolve_pipeline_class", return_value=_FakePipelineClass),
            patch.object(image_generator, "_empty_runtime_cache") as empty_runtime_cache,
        ):
            first_path = image_generator.generate_image("calm lake at sunrise", width=8, height=8)
            second_path = image_generator.generate_image("forest path", width=8, height=8)
            output_paths.extend([first_path, second_path])

        self.assertEqual(len(_FakePipelineClass.created_pipes), 1)
        self.assertIsNotNone(image_generator._cached_pipe)
        self.assertEqual(empty_runtime_cache.call_count, 0)

        for output_path in output_paths:
            self.assertTrue(os.path.exists(output_path))
            shutil.rmtree(os.path.dirname(output_path), ignore_errors=True)

    def test_sd_turbo_uses_one_step_zero_guidance_defaults(self) -> None:
        output_paths: list[str] = []

        with (
            patch.object(image_generator.config, "IMAGE_BACKEND", "diffusers"),
            patch.object(image_generator.config, "IMAGE_PIPELINE_CACHE_ENABLED", False),
            patch.object(image_generator.config, "IMAGE_MODEL_ID", "stabilityai/sd-turbo"),
            patch.object(image_generator, "_resolve_pipeline_class", return_value=_FakePipelineClass),
            patch.object(image_generator, "_empty_runtime_cache"),
        ):
            output_path = image_generator.generate_image(
                "soft forest clearing",
                negative_prompt="text, logo, people",
                width=8,
                height=8,
            )
            output_paths.append(output_path)

        self.assertEqual(len(_FakePipelineClass.created_pipes), 1)
        call_kwargs = _FakePipelineClass.created_pipes[0].calls[0]
        self.assertEqual(call_kwargs["num_inference_steps"], 1)
        self.assertEqual(call_kwargs["guidance_scale"], 0.0)
        self.assertNotIn("negative_prompt", call_kwargs)

        for output_path in output_paths:
            self.assertTrue(os.path.exists(output_path))
            shutil.rmtree(os.path.dirname(output_path), ignore_errors=True)

    def test_resolve_pipeline_class_uses_auto_pipeline_for_sd_turbo(self) -> None:
        PipelineClass = image_generator._resolve_pipeline_class("stabilityai/sd-turbo")
        self.assertEqual(PipelineClass.__name__, "AutoPipelineForText2Image")

    def test_model_cache_dir_is_model_specific(self) -> None:
        flux_dir = image_generator._model_cache_dir("black-forest-labs/FLUX.2-klein-4B")
        turbo_dir = image_generator._model_cache_dir("stabilityai/sd-turbo")
        self.assertNotEqual(flux_dir, turbo_dir)
        self.assertTrue(flux_dir.endswith("black-forest-labs--FLUX.2-klein-4B"))
        self.assertTrue(turbo_dir.endswith("stabilityai--sd-turbo"))

    def test_build_image_prompt_uses_richer_course_context(self) -> None:
        captured: dict[str, object] = {}

        class _Adapter:
            def generate(self, prompt: str, max_tokens: int = 0) -> str:
                captured["prompt"] = prompt
                captured["max_tokens"] = max_tokens
                return "A quiet geometric path through layered blue-green terraces, dawn haze, refined editorial lighting, no text."

        job_data = {
            "params": {
                "subjectLabel": "CBT",
                "targetAudience": "beginner",
                "tone": "gentle",
            }
        }
        plan = {
            "courseGoal": "Help learners interrupt spiraling anxious thoughts.",
            "intro": {"outline": "A grounded orientation to noticing thought loops without judgment."},
            "modules": [
                {
                    "moduleTitle": "Name the Thought Spiral",
                    "objective": "Spot repeating worry loops early.",
                    "lessonSummary": "Recognize the first signs of rumination in daily life.",
                    "practiceType": "guided reflection",
                }
            ],
        }

        with patch("factory_v2.shared.llm_generator._get_llm_adapter", return_value=_Adapter()):
            prompt = image_generator.build_image_prompt(
                job_data,
                "Reset the Spiral",
                "rumination and anxious thought loops",
                "course",
                plan=plan,
            )

        self.assertIn("layered blue-green terraces", prompt)
        self.assertEqual(captured["max_tokens"], 120)
        llm_prompt = str(captured["prompt"])
        self.assertIn("Course goal: Help learners interrupt spiraling anxious thoughts.", llm_prompt)
        self.assertIn("Module theme: Name the Thought Spiral", llm_prompt)
        self.assertIn("Module objective: Spot repeating worry loops early", llm_prompt)
        self.assertIn("Lesson summary: Recognize the first signs of rumination in daily life", llm_prompt)
        self.assertIn("Audience: beginner", llm_prompt)
        self.assertIn("Tone: gentle", llm_prompt)
        self.assertIn(
            "Use the provided context to generate an appropriate visual concept that fits the course.",
            llm_prompt,
        )

    def test_build_image_prompt_fallback_uses_specific_context(self) -> None:
        job_data = {
            "params": {
                "subjectLabel": "CBT",
                "tone": "gentle",
            }
        }
        plan = {
            "courseGoal": "Build steadier attention during moments of overwhelm.",
            "modules": [
                {
                    "moduleTitle": "Ground the Body",
                }
            ],
        }

        with patch(
            "factory_v2.shared.llm_generator._get_llm_adapter",
            side_effect=RuntimeError("adapter unavailable"),
        ):
            prompt = image_generator.build_image_prompt(
                job_data,
                "Steady Attention",
                "focus during overwhelm",
                "course",
                plan=plan,
            )

        self.assertIn("Steady Attention", prompt)
        self.assertIn("Ground the Body", prompt)
        self.assertIn("Build steadier attention during moments of overwhelm", prompt)
        self.assertNotEqual(
            prompt,
            "Calming minimalist nature scene, soft light, gentle colors, no text, no people, high quality.",
        )

    def test_build_image_prompt_can_ignore_saved_prompt(self) -> None:
        captured: dict[str, object] = {}

        class _Adapter:
            def generate(self, prompt: str, max_tokens: int = 0) -> str:
                captured["prompt"] = prompt
                captured["max_tokens"] = max_tokens
                return "Fresh regenerated prompt"

        job_data = {
            "imagePrompt": "Old saved prompt",
            "params": {
                "subjectLabel": "CBT",
            },
        }

        with patch("factory_v2.shared.llm_generator._get_llm_adapter", return_value=_Adapter()):
            prompt = image_generator.build_image_prompt(
                job_data,
                "Reset the Spiral",
                "rumination",
                "course",
                ignore_saved_prompt=True,
            )

        self.assertEqual(prompt, "Fresh regenerated prompt")
        self.assertEqual(captured["max_tokens"], 120)

    def test_generate_image_uses_coreml_backend_when_configured(self) -> None:
        fake_run_calls: list[dict[str, object]] = []

        with tempfile.TemporaryDirectory() as temp_dir:
            fake_python = os.path.join(temp_dir, "python")
            resources_dir = os.path.join(temp_dir, "resources")
            os.makedirs(resources_dir, exist_ok=True)
            with open(fake_python, "w", encoding="utf-8") as handle:
                handle.write("#!/bin/sh\n")

            def _fake_run(cmd, **kwargs):
                fake_run_calls.append({"cmd": cmd, **kwargs})
                output_dir = cmd[cmd.index("-o") + 1]
                image_path = os.path.join(output_dir, "thumbnail.png")
                Image.new("RGB", (8, 8), color="white").save(image_path, format="PNG")
                return SimpleNamespace(returncode=0, stdout="ok", stderr="")

            with (
                patch.object(image_generator.config, "IMAGE_BACKEND", "coreml"),
                patch.object(image_generator.config, "IMAGE_COREML_PYTHON", fake_python),
                patch.object(image_generator.config, "IMAGE_COREML_RESOURCES_DIR", resources_dir),
                patch.object(image_generator.config, "IMAGE_COREML_MODEL_VERSION", "stabilityai/stable-diffusion-xl-base-1.0"),
                patch.object(image_generator.config, "IMAGE_COREML_COMPUTE_UNIT", "CPU_AND_GPU"),
                patch.object(image_generator.config, "IMAGE_COREML_TIMEOUT_SECONDS", 120),
                patch.object(image_generator.config, "IMAGE_SEED", 321),
                patch.object(image_generator.config, "IMAGE_STEPS", 5),
                patch.object(image_generator.config, "IMAGE_GUIDANCE", 4.5),
                patch("factory_v2.shared.image_generator.subprocess.run", side_effect=_fake_run),
            ):
                output_path = image_generator.generate_image("floating blueprint fragments", negative_prompt="text")

        self.assertEqual(len(fake_run_calls), 1)
        call = fake_run_calls[0]
        cmd = call["cmd"]
        self.assertIn("python_coreml_stable_diffusion.pipeline", cmd)
        self.assertIn("--prompt", cmd)
        self.assertIn("floating blueprint fragments", cmd)
        self.assertIn("--negative-prompt", cmd)
        self.assertIn("text", cmd)
        self.assertIn("--seed", cmd)
        self.assertIn("321", cmd)
        self.assertIn("--guidance-scale", cmd)
        self.assertIn("4.5", cmd)
        self.assertTrue(os.path.exists(output_path))
        shutil.rmtree(os.path.dirname(output_path), ignore_errors=True)

    def test_generate_image_raises_when_coreml_backend_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            fake_python = os.path.join(temp_dir, "python")
            resources_dir = os.path.join(temp_dir, "resources")
            os.makedirs(resources_dir, exist_ok=True)
            with open(fake_python, "w", encoding="utf-8") as handle:
                handle.write("#!/bin/sh\n")

            with (
                patch.object(image_generator.config, "IMAGE_BACKEND", "coreml"),
                patch.object(image_generator.config, "IMAGE_COREML_PYTHON", fake_python),
                patch.object(image_generator.config, "IMAGE_COREML_RESOURCES_DIR", resources_dir),
                patch(
                    "factory_v2.shared.image_generator.subprocess.run",
                    return_value=SimpleNamespace(returncode=1, stdout="", stderr="boom"),
                ),
            ):
                with self.assertRaisesRegex(RuntimeError, "Core ML image generation failed"):
                    image_generator.generate_image("floating blueprint fragments")


if __name__ == "__main__":
    unittest.main()
