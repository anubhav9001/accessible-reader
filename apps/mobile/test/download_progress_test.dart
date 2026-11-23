import 'package:accessible_reader/download_progress.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('says sizes and progress as the engine does', () {
    expect(sizeText(273140), '273 KB');
    expect(sizeText(12340000), '12.3 MB');
    expect(sizeText(156000000), '156 MB');
    expect(sizeText(1250000000), '1.3 GB');
    expect(downloadProgressText(12000000, 30000000), '40 percent, 12 MB of 30 MB');
    expect(downloadProgressText(12000000, 0), '12 MB so far');
  });

  test('steps every 10 percent, or every 10 MB without a size', () {
    expect([0, 9, 10, 55, 100].map((p) => downloadStep(p * 1000, 100000)), [0, 0, 1, 5, 10]);
    expect([0, 9999999, 10000000, 25000000].map((b) => downloadStep(b, 0)), [0, 0, 1, 2]);
  });
}
