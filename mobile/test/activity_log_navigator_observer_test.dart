import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/router/app_router.dart';
import 'package:mobile/features/activity_log/activity_log_navigator_observer.dart';

void main() {
  group('resolveActivityRoute — path -> title', () {
    test('หน้าจริงทั้งหมด map เป็น title ภาษาไทย', () {
      expect(resolveActivityRoute(AppRoutes.home, null)?.title, 'หน้าหลัก');
      expect(
        resolveActivityRoute(AppRoutes.simulator, null)?.title,
        'ทดสอบการตั้งค่า',
      );
      expect(
        resolveActivityRoute(AppRoutes.deviceConnectionTest, null)?.title,
        'ทดสอบสัญญาณ',
      );
      expect(
        resolveActivityRoute(AppRoutes.notifications, null)?.title,
        'การแจ้งเตือน',
      );
    });

    test('/tasks/:id -> title "รายละเอียดงาน" + path ประกอบจาก id จริง', () {
      final r = resolveActivityRoute(AppRoutes.taskDetailPattern, {
        'id': 'abc',
      });
      expect(r?.title, 'รายละเอียดงาน');
      expect(r?.path, '/tasks/abc');
    });

    test('/tasks/:id ที่ไม่มี id ใน arguments -> ใช้ pattern เป็น path', () {
      final r = resolveActivityRoute(AppRoutes.taskDetailPattern, null);
      expect(r?.path, AppRoutes.taskDetailPattern);
      expect(r?.title, 'รายละเอียดงาน');
    });

    test('splash / login / null / route ที่ไม่รู้จัก -> null (ไม่บันทึก)', () {
      expect(resolveActivityRoute(AppRoutes.splash, null), isNull);
      expect(resolveActivityRoute(AppRoutes.login, null), isNull);
      expect(resolveActivityRoute(null, null), isNull);
      expect(resolveActivityRoute('/something-else', null), isNull);
    });
  });

  group('ActivityLogNavigatorObserver', () {
    ({List<ActivityRoute> logged, ActivityLogNavigatorObserver observer})
    make() {
      final logged = <ActivityRoute>[];
      return (
        logged: logged,
        observer: ActivityLogNavigatorObserver(logged.add),
      );
    }

    Route<dynamic> route(String? name, [Object? args]) => PageRouteBuilder(
      settings: RouteSettings(name: name, arguments: args),
      pageBuilder: (_, _, _) => const SizedBox(),
    );

    test('didPush หน้าจริง -> record', () {
      final m = make();
      m.observer.didPush(route(AppRoutes.simulator), null);
      expect(m.logged.map((e) => e.path).toList(), [AppRoutes.simulator]);
    });

    test('didReplace หน้าจริง -> record (didReplace เกิดตอน redirect)', () {
      final m = make();
      m.observer.didReplace(newRoute: route(AppRoutes.home), oldRoute: null);
      expect(m.logged.single.title, 'หน้าหลัก');
    });

    test('didPush splash / login -> ไม่ record', () {
      final m = make();
      m.observer
        ..didPush(route(AppRoutes.splash), null)
        ..didPush(route(AppRoutes.login), null);
      expect(m.logged, isEmpty);
    });

    test('didPop / didRemove -> ไม่ record (ไม่ได้ override)', () {
      final m = make();
      m.observer
        ..didPop(route(AppRoutes.home), null)
        ..didRemove(route(AppRoutes.home), null);
      expect(m.logged, isEmpty);
    });
  });
}
