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

    test(
      'ไม่มี response เลย (connection error) -> ใช้ e.message เหมือนเดิม',
      () async {
        final client = _clientFailingWith(
          (o) => DioException(
            requestOptions: o,
            type: DioExceptionType.connectionError,
            error: 'boom',
            message: 'Connection refused',
          ),
        );

        await expectLater(
          _login(client),
          throwsA(
            isA<ApiException>()
                .having((e) => e.message, 'message', 'Connection refused')
                .having((e) => e.statusCode, 'statusCode', null),
          ),
        );
      },
    );
  });
}
