package com.demo.broker.controller;

import com.demo.broker.model.BrokerDealSearchRequest;
import com.demo.broker.model.BrokerIntradayViewResponse;
import com.demo.broker.model.InvestorActivityResponse;
import com.demo.broker.model.IssuerExposureResponse;
import com.demo.broker.model.MaturityLadderResponse;
import com.demo.broker.model.OutstandingSummaryResponse;
import com.demo.broker.model.TopAccountsResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/broker/mm")
public class BrokerMoneyMarketController {

    @GetMapping("/outstanding")
    public ResponseEntity<OutstandingSummaryResponse> getOutstanding(
            @RequestParam(required = false) String currency,
            @RequestParam(required = false) String investorId,
            @RequestParam(required = false) String issuerId,
            @RequestParam(required = false) String maturityBucket) {
        return ResponseEntity.ok(null);
    }

    @GetMapping("/top-accounts")
    public ResponseEntity<TopAccountsResponse> getTopAccounts(
            @RequestParam(required = false) String currency,
            @RequestParam(required = false) Integer limit) {
        return ResponseEntity.ok(null);
    }

    @GetMapping("/maturity-ladder")
    public ResponseEntity<MaturityLadderResponse> getMaturityLadder(@RequestParam(required = false) String currency) {
        return ResponseEntity.ok(null);
    }

    @GetMapping("/issuers/{issuerId}/exposure")
    public ResponseEntity<IssuerExposureResponse> getIssuerExposure(
            @PathVariable String issuerId,
            @RequestParam(required = false) String currency) {
        return ResponseEntity.ok(null);
    }

    @GetMapping("/investors/{investorId}/activity")
    public ResponseEntity<InvestorActivityResponse> getInvestorActivity(
            @PathVariable String investorId,
            @RequestParam(required = false) String currency) {
        return ResponseEntity.ok(null);
    }

    @PostMapping("/deals/search")
    public ResponseEntity<OutstandingSummaryResponse> searchDeals(@RequestBody(required = false) BrokerDealSearchRequest request) {
        return ResponseEntity.ok(null);
    }

    @GetMapping("/intraday-view")
    public ResponseEntity<BrokerIntradayViewResponse> getIntradayView(@RequestParam(required = false) String currency) {
        return ResponseEntity.ok(null);
    }
}
