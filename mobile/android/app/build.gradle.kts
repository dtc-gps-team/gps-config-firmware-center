plugins {
    id("com.android.application")
    id("com.google.gms.google-services")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.example.mobile"
    // flutter_secure_storage 11.x ต้องการ compileSdk 37 แต่ Flutter 3.44 default = 36
    // override ตรงนี้ไปก่อน (platform android-37 ติดตั้งแล้วในเครื่อง)
    compileSdk = 37
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // flutter_local_notifications 10+ ต้องเปิด desugaring แม้ไม่ใช้ scheduled
        // notification (PR D — รับ push จริง) ดู README ของ plugin
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.example.mobile"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // flavor "prod" = พฤติกรรม build เดิมทุกอย่าง (applicationId com.example.mobile,
    // google-services.json ที่ android/app/ ตามเดิม) · flavor "dev" = build ทดสอบที่ใช้
    // Firebase project แยก (android/app/src/dev/google-services.json) กัน token/push
    // ปนกับ production — pubspec.yaml ตั้ง default-flavor: prod ให้คำสั่งเดิมที่ไม่ใส่
    // --flavor (เช่น CI flutter drive) ยังทำงานเหมือนเดิม
    flavorDimensions += "env"
    productFlavors {
        create("prod") {
            dimension = "env"
        }
        create("dev") {
            dimension = "env"
            applicationIdSuffix = ".dev"
        }
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    // ต้องมาคู่กับ isCoreLibraryDesugaringEnabled ข้างบน (flutter_local_notifications)
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}
