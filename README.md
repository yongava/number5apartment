# Dashboard หอพักเลขที่ 5

ระบบจัดการหอพัก 9 ห้อง — เก็บข้อมูลผู้เช่า จดมิเตอร์น้ำ/ไฟ ออกใบแจ้งหนี้ และดูกำไรสุทธิรายเดือน

- **Frontend:** `index.html` ไฟล์เดียว (vanilla JS, ไม่มี build step) — โฮสต์บน Netlify → https://number5-dashboard.netlify.app
- **Backend / ฐานข้อมูล:** Google Sheet + Google Apps Script Web App (`apps-script/Code.gs`)
- แอปทำงานได้ทันทีจากแคชในเครื่อง แล้วซิงค์ขึ้น Google Sheet อัตโนมัติ (แบบหน่วงเวลาเล็กน้อย) และโหลดจาก Sheet ทุกครั้งที่เปิด

## สถาปัตยกรรม

```
[Netlify: index.html] ──HTTPS──> [Apps Script /exec] ──> [Google Sheet]
        (แคช localStorage)          (doGet/doPost)         (ฐานข้อมูลจริง)
```

Sheet มี 7 แท็บ (Apps Script สร้าง+เขียนให้อัตโนมัติ):
`ผู้เช่า` · `มิเตอร์น้ำ` · `มิเตอร์ไฟ` · `บิล` · `ต้นทุน` · `ตั้งค่า` · `รายได้ย้อนหลัง`

## Deploy

### Frontend (Netlify)
เชื่อม repo นี้กับ Netlify (publish จาก root, ไม่มี build command) — push ขึ้น `main` แล้ว deploy อัตโนมัติ

### Backend (Apps Script) ด้วย clasp
```bash
npm i -g @google/clasp        # หรือใช้ npx @google/clasp
clasp login                   # เปิดเบราว์เซอร์เพื่อยืนยันตัวตน (ทำครั้งเดียว)
cd apps-script
clasp push                    # อัปโหลด Code.gs ขึ้นโปรเจกต์
clasp deployments             # ดู deployment id เดิม
clasp deploy -i <deploymentId> -d "number5 backend"   # อัปเดต /exec เดิม (URL คงเดิม)
```
ตั้งค่า deploy: **Execute as = Me**, **Who has access = Anyone** (มีอยู่ใน `appsscript.json` แล้ว)

> ต้องเปิด Apps Script API ที่ https://script.google.com/home/usersettings ก่อน `clasp push`

### เชื่อม frontend ↔ backend
`index.html` ฝัง Web App URL + token ไว้แล้ว (แก้ได้ในหน้า “ตั้งค่า” ของแอป) — token ปัจจุบันตรงกับ `TOKEN` ใน `Code.gs`

## ความปลอดภัย
Token เป็นเพียงการกันการเข้าถึงแบบสุ่ม (frontend เป็น public จึงไม่ใช่การป้องกันระดับสูง) — เหมาะกับ dashboard ส่วนตัว หากต้องการความปลอดภัยจริงควรเพิ่มการยืนยันตัวตน
