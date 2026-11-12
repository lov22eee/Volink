package com.volink.organization;

import com.volink.ApiTestSupport;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 기관 확인 서류 (V40, 2026-11-12): optional PDF/JPG/PNG, 3 per organization, only the manager and admins open them. */
class OrganizationDocumentTest extends ApiTestSupport {
    static final byte[] PDF = "%PDF-1.4\n1 0 obj << >> endobj\n%%EOF".getBytes(StandardCharsets.US_ASCII);

    private MockHttpServletRequestBuilder up(byte[] bytes, String name, String token) {
        return multipart("/api/me/organization/documents").file(new MockMultipartFile("file", name, "application/octet-stream", bytes)).header("Authorization", "Bearer " + token);
    }

    @Test
    void theManagerAddsUpToThreeRealFilesAndOnlyTheManagerAndAdminsOpenThem() throws Exception {
        String manager = token(member("INSTITUTION")), adminToken = token(admin());
        mvc.perform(up(PDF, "고유번호증.pdf", manager)).andExpect(status().isOk()).andExpect(jsonPath("$.name").value("고유번호증.pdf")).andExpect(jsonPath("$.type").value("application/pdf"));
        // A text file named .pdf is refused by its content.
        mvc.perform(up("hello".getBytes(StandardCharsets.UTF_8), "가짜.pdf", manager)).andExpect(status().isBadRequest());
        mvc.perform(up(new byte[] { (byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10, 0, 0 }, "../../현판.png", manager)).andExpect(status().isOk()).andExpect(jsonPath("$.name").value("현판.png"));
        mvc.perform(up(PDF, "c.pdf", manager)).andExpect(status().isOk());
        mvc.perform(up(PDF, "d.pdf", manager)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors[0].message").value("서류는 3개까지 올릴 수 있어요."));
        String list = mvc.perform(get("/api/me/organization/documents").header("Authorization", "Bearer " + manager)).andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(3)).andReturn().getResponse().getContentAsString();
        long first = json.readTree(list).get(0).get("id").asLong();
        mvc.perform(get("/api/org-documents/" + first).header("Authorization", "Bearer " + manager)).andExpect(status().isOk()).andExpect(content().contentType("application/pdf"));
        mvc.perform(get("/api/org-documents/" + first).header("Authorization", "Bearer " + adminToken)).andExpect(status().isOk());
        // Another member, and nobody signed in, cannot open it.
        mvc.perform(get("/api/org-documents/" + first).header("Authorization", "Bearer " + token(member("GENERAL")))).andExpect(status().isNotFound());
        mvc.perform(get("/api/org-documents/" + first)).andExpect(status().isUnauthorized());
        // The admin's list of waiting organizations carries them.
        long org = jdbc.queryForObject("SELECT organization_id FROM organization_documents WHERE id = ?", Long.class, first);
        String orgs = mvc.perform(get("/api/admin/organizations?status=PENDING").header("Authorization", "Bearer " + adminToken)).andReturn().getResponse().getContentAsString();
        com.fasterxml.jackson.databind.JsonNode mine = null;
        for (com.fasterxml.jackson.databind.JsonNode o : json.readTree(orgs)) if (o.get("id").asLong() == org) mine = o;
        assertThat(mine).isNotNull();
        assertThat(mine.get("documents").size()).isEqualTo(3);
        // Removing one makes room again; a general member has no organization.
        mvc.perform(delete("/api/me/organization/documents/" + first).header("Authorization", "Bearer " + manager)).andExpect(status().isNoContent());
        mvc.perform(up(PDF, "d.pdf", manager)).andExpect(status().isOk());
        mvc.perform(up(PDF, "x.pdf", token(member("GENERAL")))).andExpect(status().isForbidden());
    }
}
