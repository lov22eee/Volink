package com.volink.common;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiErrorHandler {
    @ExceptionHandler(ApiException.class)
    ResponseEntity<Map<String, Object>> handle(ApiException error) {
        return ResponseEntity.status(error.status()).body(body(error.code(), error.getMessage(), error.fieldErrors()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, Object>> unreadable(HttpMessageNotReadableException error) {
        return ResponseEntity.badRequest().body(body("VALIDATION_FAILED", "요청 형식을 확인해 주세요.", Map.of()));
    }

    public static Map<String, Object> body(String code, String message, Map<String, String> fieldErrors) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", code);
        body.put("message", message);
        body.put("fieldErrors", fieldErrors.entrySet().stream()
                .map(entry -> Map.of("field", entry.getKey(), "message", entry.getValue())).toList());
        return body;
    }

    public static Map<String, Object> body(HttpStatus status) {
        return status == HttpStatus.UNAUTHORIZED
                ? body("UNAUTHENTICATED", "로그인이 필요합니다.", Map.of())
                : body("FORBIDDEN", "이 작업을 할 권한이 없습니다.", Map.of());
    }

}
