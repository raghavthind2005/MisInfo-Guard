from optimum.onnxruntime import ORTQuantizer
from optimum.onnxruntime.configuration import AutoQuantizationConfig

model_dir = "extension/public/models/tinybert-claim-detector"
print(f"Quantizing model in {model_dir}...")

quantizer = ORTQuantizer.from_pretrained(model_dir, file_name="model.onnx")
qconfig = AutoQuantizationConfig.arm64(is_static=False, per_channel=True)

# Save as 'model_quantized.onnx' (standard name for Transformers.js)
quantizer.quantize(save_dir=model_dir, quantization_config=qconfig)

print("Quantization complete!")
