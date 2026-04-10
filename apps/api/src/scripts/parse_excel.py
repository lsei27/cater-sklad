import openpyxl
import json
import sys

def parse_excel(filename):
    wb = openpyxl.load_workbook(filename, data_only=True)
    sheet = wb.active
    
    headers = [cell.value for cell in sheet[1]]
    data = []
    
    for row in sheet.iter_rows(min_row=2, values_only=True):
        if not any(row): continue
        item = dict(zip(headers, row))
        data.append(item)
        
    return data

if __name__ == "__main__":
    try:
        if len(sys.argv) < 2:
            print("Usage: python parse_excel.py <filename>", file=sys.stderr)
            sys.exit(1)
            
        filename = sys.argv[1]
        results = parse_excel(filename)
        print(json.dumps(results, indent=2, ensure_ascii=False))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
