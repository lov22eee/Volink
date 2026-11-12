-- 기관 확인 서류 (2026-11-12, 선택): 고유번호증·사업자등록증 등. The file is on the server disk (volink.upload-dir, not git);
-- only the random key is kept here. The manager of that organization and admins can open it.
CREATE TABLE organization_documents (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    organization_id BIGINT NOT NULL,
    storage_key VARCHAR(80) NOT NULL,
    original_name VARCHAR(120) NOT NULL,
    content_type VARCHAR(40) NOT NULL,
    size_bytes INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_org_document_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    CONSTRAINT uq_org_document_key UNIQUE (storage_key),
    CONSTRAINT ck_org_document_type CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png'))
);
CREATE INDEX ix_org_document_org ON organization_documents (organization_id);
