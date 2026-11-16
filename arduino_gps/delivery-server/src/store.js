const fs = require('fs');
const path = require('path');

// เก็บข้อมูลเป็นไฟล์ JSON (ใช้แทน Database สำหรับทดสอบ / server instance เดียว)
class JsonStore {
  constructor(file, initial) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : structuredClone(initial);
    for (const key of Object.keys(initial)) {
      if (!(key in this.data)) this.data[key] = structuredClone(initial[key]);
    }
    this.save();
  }

  // เขียนไฟล์ชั่วคราวก่อนแล้ว rename เพื่อไม่ให้ไฟล์เสียถ้าไฟดับกลางคัน
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    // Windows/OneDrive/editor อาจล็อกไฟล์ชั่วคราว: ลองใหม่สั้นๆ และไม่ให้ทั้งเซิร์ฟเวอร์ดับเพราะบันทึกไม่ได้
    // รอบนี้ไม่สำเร็จ ข้อมูลยังอยู่ใน memory และถูกเขียนอีกครั้งตอน save ถัดไป
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, this.file);
        return;
      } catch (err) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
        if (attempt >= 4) {
          console.error(`[store] บันทึก ${this.file} ไม่สำเร็จ (${err.code}) จะลองใหม่ตอน save ถัดไป`);
          return;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * 2 ** attempt);
      }
    }
  }
}

module.exports = { JsonStore };
