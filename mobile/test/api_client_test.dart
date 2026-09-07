import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/api/api_client.dart';
import 'package:mobile/core/api/models.dart';

/// Interceptor that fails every request with a preset [DioException], so we can
/// exercise [ApiClient]'s error mapping without a real server.
class _RejectInterceptor extends Interceptor {
  _RejectInterceptor(this.build);

  final DioException Function(RequestOptions options) build;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    handler.reject(build(options));
  }
}

ApiClient _clientFailingWith(DioException Function(RequestOptions) build) {
  final dio = Dio(BaseOptions(baseUrl: 'http://test.local'))
    ..interceptors.add(_RejectInterceptor(build));
  return ApiClient(dio: dio);
}

/// Adapter that returns a canned JSON body for every request and records the
/// [RequestOptions] it saw — lets us assert the method / path / body an
/// [ApiClient] method produced, and exercise the happy-path decoding.
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.body, {this.statusCode = 200});

  final Object? body;
  final int statusCode;
  RequestOptions? lastRequest;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    lastRequest = options;
    return ResponseBody.fromString(
      jsonEncode(body),
      statusCode,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

({ApiClient client, _FakeAdapter adapter}) _clientReturning(
  Object? body, {
  int statusCode = 200,
}) {
  final adapter = _FakeAdapter(body, statusCode: statusCode);
  final dio = Dio(BaseOptions(baseUrl: 'http://test.local'))
    ..httpClientAdapter = adapter;
  return (client: ApiClient(dio: dio), adapter: adapter);
}

Map<String, dynamic> _taskJson({
  String id = 't1',
  String status = 'pending',
  String? deviceId,
}) => {
  'id': id,
  'title': 'งาน $id',
  'assignedTo': 'u1',
  'deviceId': deviceId,
  'status': status,
  'createdAt': '2026-09-01T00:00:00.000Z',
  'updatedAt': '2026-09-02T00:00:00.000Z',
};

Response<dynamic> _response(RequestOptions o, int status, dynamic data) =>
    Response<dynamic>(
      requestOptions: o,
      statusCode: status,
      statusMessage: 'Unauthorized',
      data: data,
    );

Future<void> _login(ApiClient client) =>
    client.login(const LoginRequest(username: 'x', password: 'y'));

void main() {
  group('ApiClient._wrap error message', () {
    test(
      'อ่าน response.data["message"] (ข้อความไทย) แทน statusMessage',
      () async {
        final client = _clientFailingWith(
          (o) => DioException(
            requestOptions: o,
            response: _response(o, 401, {
              'message': 'Username/Password ไม่ถูกต้อง',
              'error': 'Unauthorized',
              'statusCode': 401,
            }),
          ),
        );

        await expectLater(
          _login(client),
          throwsA(
            isA<ApiException>()
                .having(
                  (e) => e.message,
                  'message',
                  'Username/Password ไม่ถูกต้อง',
                )
                .having((e) => e.statusCode, 'statusCode', 401),
          ),
        );
      },
    );

    test(
      'response.data ไม่มี key "message" -> fallback statusMessage เหมือนเดิม',
      () async {
        final client = _clientFailingWith(
          (o) => DioException(
            requestOptions: o,
            response: _response(o, 401, {
              'error': 'Unauthorized',
              'statusCode': 401,
            }),
          ),
        );

        await expectLater(
          _login(client),
          throwsA(
            isA<ApiException>().having(
              (e) => e.message,
              'message',
              'Unauthorized',
            ),
          ),
        );
      },
    );

    test(
      'response.data ไม่ใช่ Map (เช่น HTML string) -> fallback statusMessage',
      () async {
        final client = _clientFailingWith(
          (o) => DioException(
            requestOptions: o,
            response: _response(o, 502, '<html>Bad Gateway</html>'),
          ),
        );

        await expectLater(
          _login(client),
          throwsA(
            isA<ApiException>().having(
              (e) => e.message,
              'message',
              'Unauthorized',
            ),
          ),
        );
      },
    );

    test(
      'response.data["message"] เป็น string ว่าง -> fallback statusMessage',
      () async {
        final client = _clientFailingWith(
          (o) => DioException(
            requestOptions: o,
            response: _response(o, 401, {'message': ''}),
          ),
        );

        await expectLater(
          _login(client),
          throwsA(
            isA<ApiException>().having(
              (e) => e.message,
              'message',
              'Unauthorized',
            ),
          ),
        );
      },
    );

    test('ไม่มี response เลย (connection error) -> ข้อความไทยอ่านเข้าใจได้ '
        'ไม่ใช่ raw DioException.message (regression test: เคยหลุดข้อความดิบ '
        'อย่าง "The connection errored: Connection refused ..." ไปที่ UI '
        'ตรง ๆ พบตอนทดสอบบน Android Emulator 7 กันยายน 2569)', () async {
      final client = _clientFailingWith(
        (o) => DioException(
          requestOptions: o,
          type: DioExceptionType.connectionError,
          error: 'boom',
          // สตริงจริงที่ Dio สร้างให้ตอน connection refused — ต้อง "ไม่"
          // โผล่ใน ApiException.message เลยหลัง fix
          message:
              'The connection errored: Connection refused This indicates '
              'an error which most likely cannot be solved by the '
              'library.',
        ),
      );

      await expectLater(
        _login(client),
        throwsA(
          isA<ApiException>()
              .having(
                (e) => e.message,
                'message',
                isNot(contains('cannot be solved by the library')),
              )
              .having(
                (e) => e.message,
                'message',
                'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต/เซิร์ฟเวอร์แล้วลองใหม่อีกครั้ง',
              )
              .having((e) => e.statusCode, 'statusCode', null),
        ),
      );
    });

    test('connection timeout -> ข้อความไทยเดียวกับ connection error', () async {
      final client = _clientFailingWith(
        (o) => DioException(
          requestOptions: o,
          type: DioExceptionType.connectionTimeout,
          message: 'Connecting timed out',
        ),
      );

      await expectLater(
        _login(client),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'message',
            'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต/เซิร์ฟเวอร์แล้วลองใหม่อีกครั้ง',
          ),
        ),
      );
    });

    test('DioExceptionType.unknown ไม่มี message เลย -> generic Thai fallback '
        '(ไม่ใช่ "Network error" ภาษาอังกฤษเหมือนเดิม)', () async {
      final client = _clientFailingWith(
        (o) => DioException(requestOptions: o, type: DioExceptionType.unknown),
      );

      await expectLater(
        _login(client),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'message',
            'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง',
          ),
        ),
      );
    });
  });

  group('task endpoints', () {
    test('listTasks -> GET /tasks, maps the JSON array', () async {
      final (:client, :adapter) = _clientReturning([
        _taskJson(id: 't1', status: 'pending', deviceId: 'DVC-1'),
        _taskJson(id: 't2', status: 'completed'),
      ]);

      final tasks = await client.listTasks();

      expect(adapter.lastRequest?.method, 'GET');
      expect(adapter.lastRequest?.path, '/tasks');
      expect(tasks.map((t) => t.id), ['t1', 't2']);
      expect(tasks[0].deviceId, 'DVC-1');
      expect(tasks[1].status, TaskStatus.completed);
    });

    test('listTasks -> tolerates an empty array', () async {
      final (:client, :adapter) = _clientReturning(<dynamic>[]);
      expect(await client.listTasks(), isEmpty);
      expect(adapter.lastRequest?.path, '/tasks');
    });

    test('getTask -> GET /tasks/{id}', () async {
      final (:client, :adapter) = _clientReturning(
        _taskJson(id: 'abc', status: 'in_progress'),
      );

      final task = await client.getTask('abc');

      expect(adapter.lastRequest?.method, 'GET');
      expect(adapter.lastRequest?.path, '/tasks/abc');
      expect(task.status, TaskStatus.inProgress);
    });

    test(
      'updateTaskStatus -> PATCH /tasks/{id} with a status-only body',
      () async {
        final (:client, :adapter) = _clientReturning(
          _taskJson(id: 'abc', status: 'completed'),
        );

        final task = await client.updateTaskStatus('abc', TaskStatus.completed);

        expect(adapter.lastRequest?.method, 'PATCH');
        expect(adapter.lastRequest?.path, '/tasks/abc');
        expect(adapter.lastRequest?.data, {'status': 'completed'});
        expect(task.status, TaskStatus.completed);
      },
    );

    test('getTask -> 404 maps to ApiException', () async {
      final client = _clientFailingWith(
        (o) => DioException(
          requestOptions: o,
          response: _response(o, 404, {'message': 'ไม่พบงานนี้'}),
        ),
      );

      await expectLater(
        client.getTask('missing'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.statusCode, 'statusCode', 404)
              .having((e) => e.message, 'message', 'ไม่พบงานนี้'),
        ),
      );
    });
  });

  group('config endpoints', () {
    Map<String, dynamic> configJson({
      String id = 'c1',
      String status = 'draft',
      String deviceModel = 'GT06N',
    }) => {
      'id': id,
      'deviceModel': deviceModel,
      'protocol': 'TCP',
      'status': status,
      'fields': {'APN': 'internet'},
    };

    test('listConfigs -> GET /config, maps the JSON array', () async {
      final (:client, :adapter) = _clientReturning([
        configJson(id: 'c1', status: 'draft'),
        configJson(id: 'c2', status: 'approved'),
      ]);

      final configs = await client.listConfigs();

      expect(adapter.lastRequest?.method, 'GET');
      expect(adapter.lastRequest?.path, '/config');
      expect(configs.map((c) => c.id), ['c1', 'c2']);
      expect(configs[0].status, ConfigStatus.draft);
      expect(configs[1].status, ConfigStatus.approved);
    });

    test('listConfigs -> tolerates an empty array', () async {
      final (:client, :adapter) = _clientReturning(<dynamic>[]);
      expect(await client.listConfigs(), isEmpty);
      expect(adapter.lastRequest?.path, '/config');
    });
  });

  group('notification endpoints', () {
    Map<String, dynamic> notiJson({String id = 'n1', bool read = false}) => {
      'id': id,
      'userId': 'u1',
      'type': 'task_assigned',
      'payload': const <String, dynamic>{},
      'read': read,
      'createdAt': '2026-09-04T08:30:00.000Z',
    };

    test(
      'listNotifications() -> GET /notifications, ไม่มี query unread',
      () async {
        final (:client, :adapter) = _clientReturning([notiJson()]);

        final items = await client.listNotifications();

        expect(adapter.lastRequest?.method, 'GET');
        expect(adapter.lastRequest?.path, '/notifications');
        expect(adapter.lastRequest?.queryParameters, isEmpty);
        expect(items.single.type, NotificationType.taskAssigned);
      },
    );

    test('listNotifications(unread: true) -> ?unread=true', () async {
      final (:client, :adapter) = _clientReturning(<dynamic>[]);

      await client.listNotifications(unread: true);

      expect(adapter.lastRequest?.queryParameters, {'unread': true});
    });

    test('markNotificationRead -> PATCH /notifications/{id}/read', () async {
      final (:client, :adapter) = _clientReturning(
        notiJson(id: 'abc', read: true),
      );

      final n = await client.markNotificationRead('abc');

      expect(adapter.lastRequest?.method, 'PATCH');
      expect(adapter.lastRequest?.path, '/notifications/abc/read');
      expect(n.read, isTrue);
    });
  });
}
