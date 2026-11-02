import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// "Version 0.2.0 (build 2)", from pubspec.yaml's `version`, so anyone can tell which build is installed.
final Future<String> appVersion =
    PackageInfo.fromPlatform().then((info) => 'Version ${info.version} (build ${info.buildNumber})');

class AppVersionText extends StatelessWidget {
  const AppVersionText({super.key, this.textAlign});

  final TextAlign? textAlign;

  @override
  Widget build(BuildContext context) => FutureBuilder<String>(
        future: appVersion,
        builder: (context, snapshot) =>
            Text(snapshot.data ?? '', textAlign: textAlign, style: Theme.of(context).textTheme.bodySmall),
      );
}
