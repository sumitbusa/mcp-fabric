package com.demo.refdata.controller;

import com.demo.refdata.model.AccountRefData;
import com.demo.refdata.model.CounterpartyLink;
import com.demo.refdata.model.InvestorRefData;
import com.demo.refdata.model.IssuerRefData;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/refdata")
public class ReferenceDataController {

    @GetMapping("/investors/{investorId}")
    public ResponseEntity<InvestorRefData> getInvestor(@PathVariable String investorId) {
        return ResponseEntity.ok(null);
    }

    @GetMapping("/issuers/{issuerId}")
    public ResponseEntity<IssuerRefData> getIssuer(@PathVariable String issuerId) {
        return ResponseEntity.ok(null);
    }

    @GetMapping("/accounts/{accountId}")
    public ResponseEntity<AccountRefData> getAccount(@PathVariable String accountId) {
        return ResponseEntity.ok(null);
    }

    @GetMapping("/investors")
    public ResponseEntity<List<InvestorRefData>> listInvestors(
            @RequestParam(required = false) String country,
            @RequestParam(required = false) String investorType) {
        return ResponseEntity.ok(List.of());
    }

    @GetMapping("/issuers")
    public ResponseEntity<List<IssuerRefData>> listIssuers(
            @RequestParam(required = false) String country,
            @RequestParam(required = false) String sector) {
        return ResponseEntity.ok(List.of());
    }

    @GetMapping("/counterparties/{counterpartyId}/link")
    public ResponseEntity<CounterpartyLink> getCounterpartyLink(@PathVariable String counterpartyId) {
        return ResponseEntity.ok(null);
    }
}
