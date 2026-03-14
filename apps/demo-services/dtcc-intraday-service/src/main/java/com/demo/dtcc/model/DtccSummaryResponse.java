package com.demo.dtcc.model;

public class DtccSummaryResponse {
    private String currency;
    private String asOf;
    private Integer obligationCount;
    private Double totalAmount;
    private String largestIssuerId;
    private String peakAccountId;

    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }
    public String getAsOf() { return asOf; }
    public void setAsOf(String asOf) { this.asOf = asOf; }
    public Integer getObligationCount() { return obligationCount; }
    public void setObligationCount(Integer obligationCount) { this.obligationCount = obligationCount; }
    public Double getTotalAmount() { return totalAmount; }
    public void setTotalAmount(Double totalAmount) { this.totalAmount = totalAmount; }
    public String getLargestIssuerId() { return largestIssuerId; }
    public void setLargestIssuerId(String largestIssuerId) { this.largestIssuerId = largestIssuerId; }
    public String getPeakAccountId() { return peakAccountId; }
    public void setPeakAccountId(String peakAccountId) { this.peakAccountId = peakAccountId; }
}
