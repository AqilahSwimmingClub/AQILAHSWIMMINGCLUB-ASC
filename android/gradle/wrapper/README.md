# gradle-wrapper.jar

Berkas `gradle-wrapper.jar` di folder ini **bukan wrapper resmi Gradle**,
melainkan bootstrapper ringkas yang sumbernya ada di
`src/org/gradle/wrapper/GradleWrapperMain.java`.

Tugasnya: mengunduh distribusi Gradle sesuai `distributionUrl` pada
`gradle-wrapper.properties`, mengekstraknya ke
`~/.gradle/wrapper/dists/`, lalu menjalankan `bin/gradle` dengan argumen
yang diteruskan apa adanya.

## WAJIB dikompilasi dengan --release 11

Versi sebelumnya dikompilasi untuk Java 21 (class file major version 65).
Akibatnya:

- JDK 17 menolak memuatnya: `UnsupportedClassVersionError ... class file
  version 65.0, this version of the Java Runtime only recognizes class file
  versions up to 61.0`
- Java 25 bisa memuatnya, tetapi Gradle 8.9 menolak Java 25:
  `Unsupported class file major version 69`

Tidak ada satu pun JDK yang memenuhi kedua syarat itu, sehingga perakitan APK
selalu gagal. Menargetkan Java 11 membuat berkas ini dapat dimuat oleh JDK 11
ke atas, termasuk JDK 17 dan 21 yang didukung Gradle 8.9.

## Cara kompilasi ulang

```sh
javac --release 11 -d out src/org/gradle/wrapper/GradleWrapperMain.java
jar cfe gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain -C out org
```

Setelah itu pastikan hasilnya masih major version 55:

```sh
javap -verbose -cp gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain | grep major
```

## Batasan versi Java

| Komponen | Java yang didukung |
|---|---|
| `gradle-wrapper.jar` ini | 11 ke atas |
| Gradle 8.9 | 17 sampai 22 |
| Android Gradle Plugin 8.7.3 | 17 ke atas |

Irisan yang aman: **JDK 17 sampai 22**. `BUAT-APK-UPDATE.bat` memilihkannya
secara otomatis dan meneruskannya lewat `JAVA_HOME`.
