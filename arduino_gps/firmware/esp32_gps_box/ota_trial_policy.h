#pragma once

#include <stdint.h>

// Hardware-independent OTA trial transitions. Compile-time assertions below exercise this
// exact header in every ESP32 build.
enum class OtaTrialPhase : uint8_t {
  NONE = 0,
  WAIT_CONFIRM,
  WAIT_WELCOME,
  TIMED_OUT,
};

enum class OtaTrialEvent : uint8_t {
  WIFI_READY,
  WELCOME,
  TIMEOUT,
  BOOT,
};

enum class OtaTrialAction : uint8_t {
  CONTINUE_TRIAL,
  MARK_BOOTLOADER_VALID,
  ACCEPT_TRIAL,
  BOOTLOADER_ROLLBACK,
  APP_ROLLBACK,
  CONTINUE_AND_LOG,
};

enum class OtaBootAction : uint8_t {
  START_PENDING_CONFIRM,
  PENDING_WITHOUT_OTA_RECORD,
  RESUME_APP_TRIAL,
  CLEAR_STALE_TRIAL,
};

static constexpr OtaBootAction decideOtaBoot(
    bool pendingVerify, OtaTrialPhase storedPhase, bool hasOtaRecord, bool targetMatches) {
  if (pendingVerify) {
    // Bootloader will roll back a reset in PENDING_VERIFY, so every such boot is fresh.
    return hasOtaRecord && targetMatches ? OtaBootAction::START_PENDING_CONFIRM
                                         : OtaBootAction::PENDING_WITHOUT_OTA_RECORD;
  }
  if (storedPhase == OtaTrialPhase::WAIT_WELCOME && hasOtaRecord && targetMatches) {
    return OtaBootAction::RESUME_APP_TRIAL;
  }
  return OtaBootAction::CLEAR_STALE_TRIAL;
}

static constexpr uint8_t OTA_TRIAL_MAX_BOOT_COUNT = 5;

static constexpr OtaTrialAction decideOtaTrial(
    OtaTrialPhase phase,
    OtaTrialEvent event,
    uint8_t boots,
    bool rollbackBootable) {
  if (phase == OtaTrialPhase::WAIT_CONFIRM) {
    if (event == OtaTrialEvent::WIFI_READY && boots > 0 && rollbackBootable) return OtaTrialAction::MARK_BOOTLOADER_VALID;
    if (event == OtaTrialEvent::TIMEOUT) return OtaTrialAction::BOOTLOADER_ROLLBACK;
    return OtaTrialAction::CONTINUE_TRIAL;
  }

  if (phase == OtaTrialPhase::NONE && event == OtaTrialEvent::WELCOME) {
    return OtaTrialAction::MARK_BOOTLOADER_VALID;
  }

  if (phase == OtaTrialPhase::WAIT_WELCOME) {
    if (event == OtaTrialEvent::WELCOME) return OtaTrialAction::ACCEPT_TRIAL;
    const bool exceededBootLimit = event == OtaTrialEvent::BOOT && boots > OTA_TRIAL_MAX_BOOT_COUNT;
    if ((event == OtaTrialEvent::TIMEOUT || exceededBootLimit) && rollbackBootable) {
      return OtaTrialAction::APP_ROLLBACK;
    }
    if ((event == OtaTrialEvent::TIMEOUT || exceededBootLimit) && !rollbackBootable) {
      return OtaTrialAction::CONTINUE_AND_LOG;
    }
  }

  return OtaTrialAction::CONTINUE_TRIAL;
}

static_assert(decideOtaTrial(OtaTrialPhase::WAIT_CONFIRM, OtaTrialEvent::WIFI_READY, 0, true) ==
                  OtaTrialAction::CONTINUE_TRIAL,
              "confirmation cannot happen before the first trial boot");
static_assert(decideOtaTrial(OtaTrialPhase::WAIT_CONFIRM, OtaTrialEvent::WIFI_READY, 1, true) ==
                  OtaTrialAction::MARK_BOOTLOADER_VALID,
              "bootloader confirmation requires a verified rollback image");
static_assert(decideOtaTrial(OtaTrialPhase::WAIT_CONFIRM, OtaTrialEvent::WIFI_READY, 1, false) ==
                  OtaTrialAction::CONTINUE_TRIAL,
              "invalid rollback image must leave bootloader behavior unchanged");
static_assert(decideOtaTrial(OtaTrialPhase::WAIT_CONFIRM, OtaTrialEvent::TIMEOUT, 1, false) ==
                  OtaTrialAction::BOOTLOADER_ROLLBACK,
              "unconfirmed image requests the bootloader rollback at timeout");
static_assert(decideOtaTrial(OtaTrialPhase::NONE, OtaTrialEvent::WELCOME, 0, false) ==
                  OtaTrialAction::MARK_BOOTLOADER_VALID,
              "unmanaged pending image may confirm on WELCOME");
static_assert(decideOtaTrial(OtaTrialPhase::WAIT_WELCOME, OtaTrialEvent::BOOT, 5, true) ==
                  OtaTrialAction::CONTINUE_TRIAL,
              "five trial boots are allowed");
static_assert(decideOtaTrial(OtaTrialPhase::WAIT_WELCOME, OtaTrialEvent::BOOT, 6, true) ==
                  OtaTrialAction::APP_ROLLBACK,
              "the sixth trial boot rolls back");
static_assert(decideOtaTrial(OtaTrialPhase::WAIT_WELCOME, OtaTrialEvent::BOOT, 6, false) ==
                  OtaTrialAction::CONTINUE_AND_LOG,
              "invalid rollback target must not create a reboot loop");
static_assert(decideOtaBoot(true, OtaTrialPhase::TIMED_OUT, true, true) ==
                  OtaBootAction::START_PENDING_CONFIRM,
              "pending image always starts fresh despite stale timed-out NVS");
static_assert(decideOtaBoot(false, OtaTrialPhase::TIMED_OUT, true, true) ==
                  OtaBootAction::CLEAR_STALE_TRIAL,
              "non-pending timed-out record is cleared without rollback");
static_assert(decideOtaBoot(false, OtaTrialPhase::WAIT_WELCOME, false, true) ==
                  OtaBootAction::CLEAR_STALE_TRIAL,
              "non-pending trial cannot resume without an OTA record");
