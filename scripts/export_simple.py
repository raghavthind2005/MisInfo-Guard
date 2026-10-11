from optimum.onnxruntime import ORTModelForSequenceClassification
from transformers import AutoTokenizer
import os

model_id = "yevhenkost/claim-detection-claimbuster-binary-TinyBERT_General_4L_312D"
output_dir = "extension/public/models/tinybert-claim-detector"

print(f"Exporting {model_id} to {output_dir}...")

# Load model and tokenizer
model = ORTModelForSequenceClassification.from_pretrained(model_id, export=True)
tokenizer = AutoTokenizer.from_pretrained(model_id)

# Save ONNX model and tokenizer
model.save_pretrained(output_dir)
tokenizer.save_pretrained(output_dir)

print("Done! ONNX model saved.")
