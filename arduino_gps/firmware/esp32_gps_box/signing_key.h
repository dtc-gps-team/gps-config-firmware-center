#pragma once

// public key สำหรับตรวจลายเซ็น firmware (ECDSA P-256) — คู่กับ delivery-server/keys/firmware-signing-private.pem
// ถ้าสร้างกุญแจใหม่ด้วย npm run keygen ต้องแก้ค่านี้แล้วแฟลชผ่าน USB ใหม่
static const char FIRMWARE_SIGNING_PUBLIC_KEY[] =
  "-----BEGIN PUBLIC KEY-----\n"
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE19jhEDLMuGO3XHZwUK9skmT/sPE2\n"
  "p7yXOsFtnLqgE70/tmE3gwD0dPiZOAAjBqr/UWwN/uTvSljxTCDIzOjs9Q==\n"
  "-----END PUBLIC KEY-----\n";
