import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.camerawatermark.app',
  appName: '相机水印',
  webDir: 'www',
  server: {
    androidScheme: 'https'
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystorePassword: undefined,
      keystoreAlias: undefined,
      keystoreAliasPassword: undefined,
      releaseType: 'APK'
    }
  },
  plugins: {
    Camera: {
      // Android 权限配置
      androidPermissions: [
        'android.permission.READ_MEDIA_IMAGES',      // Android 13+
        'android.permission.READ_EXTERNAL_STORAGE',   // Android 12-
        'android.permission.CAMERA'
      ]
    },
    Filesystem: {
      // 允许读取外部存储
      androidPermissions: [
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_EXTERNAL_STORAGE'
      ]
    }
  }
};

export default config;
