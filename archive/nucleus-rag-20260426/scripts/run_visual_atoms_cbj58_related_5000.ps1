$ErrorActionPreference = "Stop"
$env:PYTHONIOENCODING = "utf-8"

$terms = "高脂血症,胆固醇,低密度脂蛋白,高胆固醇,斑块,血栓,血压,高血压,颈动脉,冠状动脉,动脉粥样硬化,粥样硬化,钙化,吸烟,烟草,内皮,心脏病,脑卒中,卒中,冠心病,Hyperlipidemia,Cholesterol,LDL,Atherosclerosis,Plaque,Thromb,Hypertension,High Blood Pressure,Blood Pressure,Smoking,Tobacco,Coronary,Carotid,Artery,Heart Disease,Heart Attack,Stroke,Calcification,Cardiovascular"

python scripts\build_visual_atom_index.py `
  --stage infer `
  --out scripts\asset_index\visual_atoms_cbj58_related_5000.jsonl `
  --file-contains $terms `
  --limit 5000 `
  --batch-size 5 `
  --concurrency 10 `
  --model sonnet `
  --overwrite
